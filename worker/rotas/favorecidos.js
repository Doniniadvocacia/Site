// Configurações › Favorecidos: cadastro usado no campo "Favorecido" dos lançamentos financeiros.
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora, cifrar, decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt, soDigitos, cpfValido, cnpjValido, formatarCpf, formatarCnpj } from "./comum.js";

const MSG = { salvo: ["aviso", "Favorecido salvo."], removido: ["aviso", "Favorecido removido da lista. Lançamentos antigos mantêm o nome."],
  duplicado: ["erro", "Já existe um favorecido com esse nome."], documento: ["erro", "CPF ou CNPJ inválido."], vazio: ["erro", "Informe o nome."], sessao: ["erro", "Sessão expirada."] };

// Dados bancários ficam num JSON cifrado { banco, agencia, conta, pix }. Registros antigos (texto livre) caem em "banco".
const CAMPOS_BANCO = [["banco", "Banco", 80], ["agencia", "Agência", 20], ["conta", "Conta", 30], ["pix", "Chave Pix", 140]];
export function lerBanco(texto) {
  const vazio = { banco: "", agencia: "", conta: "", pix: "" };
  if (!texto) return vazio;
  try { const j = JSON.parse(texto); if (j && typeof j === "object") return { ...vazio, ...j }; } catch { /* texto livre antigo */ }
  return { ...vazio, banco: texto };
}
export function bancoTexto(b) {
  return [b.banco && `Banco: ${b.banco}`, b.agencia && `Agência: ${b.agencia}`, b.conta && `Conta: ${b.conta}`, b.pix && `Pix: ${b.pix}`].filter(Boolean).join(" · ");
}

// Lista para o formulário do Financeiro: [{ id, nome, dados }] — dados já em texto para o lançamento.
export async function listaFavorecidos(env) {
  const { results } = await env.DB.prepare("SELECT id, nome, dados_bancarios_enc FROM favorecidos WHERE ativo = 1 ORDER BY nome COLLATE NOCASE").all();
  return Promise.all(results.map(async (r) => ({ id: r.id, nome: r.nome, dados: bancoTexto(lerBanco(await decifrar(env, r.dados_bancarios_enc))) })));
}

function lerDocumento(v) {
  const d = soDigitos(v);
  if (!d) return { ok: true, valor: null };
  if (d.length === 11 && cpfValido(d)) return { ok: true, valor: formatarCpf(d) };
  if (d.length === 14 && cnpjValido(d)) return { ok: true, valor: formatarCnpj(d) };
  return { ok: false };
}

export async function favorecidos(req, env, sessao) {
  const url = new URL(req.url);
  const volta = (c, id) => redirecionar(`/sistema/favorecidos?msg=${c}${id ? `&editar=${id}` : ""}`);
  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return volta("sessao");
    const id = Number(f.get("id")) || null;
    if (f.get("acao") === "remover" && id) {
      await env.DB.prepare("UPDATE favorecidos SET ativo = 0, atualizado_em = ? WHERE id = ?").bind(agora(), id).run();
      await auditar(env, req, sessao.usuario_id, "favorecido_removido", `favorecido ${id}`);
      return volta("removido");
    }
    const nome = txt(f, "nome", 150);
    if (!nome) return volta("vazio", id);
    const doc = lerDocumento(txt(f, "documento", 20));
    if (!doc.ok) return volta("documento", id);
    const dup = await env.DB.prepare("SELECT id, ativo FROM favorecidos WHERE nome = ? AND id != ?").bind(nome, id || 0).first();
    if (dup && dup.ativo) return volta("duplicado", id);
    const [docEnc, bancEnc] = await Promise.all([cifrar(env, doc.valor), cifrar(env, (() => {
      const b = Object.fromEntries(CAMPOS_BANCO.map(([k, , max]) => [k, txt(f, k, max) || ""]));
      return Object.values(b).some(Boolean) ? JSON.stringify(b) : null;
    })())]);
    if (dup && !id) {
      await env.DB.prepare("UPDATE favorecidos SET ativo = 1, documento_enc = ?, dados_bancarios_enc = ?, atualizado_em = ? WHERE id = ?").bind(docEnc, bancEnc, agora(), dup.id).run();
    } else if (id) {
      await env.DB.prepare("UPDATE favorecidos SET nome = ?, documento_enc = ?, dados_bancarios_enc = ?, atualizado_em = ? WHERE id = ?").bind(nome, docEnc, bancEnc, agora(), id).run();
    } else {
      await env.DB.prepare("INSERT INTO favorecidos (nome, documento_enc, dados_bancarios_enc, criado_em) VALUES (?, ?, ?, ?)").bind(nome, docEnc, bancEnc, agora()).run();
    }
    await auditar(env, req, sessao.usuario_id, id ? "favorecido_alterado" : "favorecido_criado", nome);
    return volta("salvo");
  }
  const { results } = await env.DB.prepare("SELECT * FROM favorecidos WHERE ativo = 1 ORDER BY nome COLLATE NOCASE").all();
  const lista = await Promise.all(results.map(async (r) => ({ ...r, documento: await decifrar(env, r.documento_enc), banco: lerBanco(await decifrar(env, r.dados_bancarios_enc)) })));
  const editando = lista.find((x) => x.id === Number(url.searchParams.get("editar")));
  const m = MSG[url.searchParams.get("msg")];
  const v = editando || { banco: lerBanco(null) };
  return resposta(pagina({
    titulo: "Favorecidos", sessao, ...(m ? { [m[0]]: m[1] } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/configuracoes">Configurações</a></p>
      <h1>Favorecidos</h1>
      <p class="dica">Pessoas e empresas que recebem pagamentos do escritório ou repasses. Aparecem no campo "Favorecido" dos lançamentos; os dados bancários preenchem o lançamento automaticamente.</p>
      <section class="cartao"><h2>${editando ? `Editar ${editando.nome}` : "Novo favorecido"}</h2>
        <form method="post" class="formulario grade-form grade-favorecido">${campoCsrf(sessao)}${editando ? html`<input type="hidden" name="id" value="${String(editando.id)}">` : ""}
          <label class="fav-nome">Nome<input name="nome" required maxlength="150" value="${v.nome || ""}"></label>
          <label>CPF/CNPJ<input name="documento" maxlength="18" inputmode="numeric" data-mascara="documento" value="${v.documento || ""}"></label>
          ${CAMPOS_BANCO.map(([k, rot, max]) => html`<label>${rot}<input name="${k}" maxlength="${String(max)}" value="${v.banco[k] || ""}"${k === "pix" ? html` placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória"` : ""}></label>`)}
          <div class="largo botoes-form"><button type="submit">${editando ? "Salvar alterações" : "Cadastrar favorecido"}</button>${editando ? html`<a class="botao-link botao-secundario" href="/sistema/favorecidos">Cancelar</a>` : ""}</div>
        </form>
        <p class="dica">Só o nome é obrigatório. CPF/CNPJ e dados bancários são gravados cifrados.</p>
      </section>
      <section class="cartao"><h2>Cadastrados <span class="contagem">${String(lista.length)}</span></h2>
        ${lista.length ? html`<div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Banco</th><th>Agência</th><th>Conta</th><th>Chave Pix</th><th></th></tr></thead>
          <tbody>${lista.map((x) => html`<tr><td>${x.nome}</td><td>${x.documento || "—"}</td>${CAMPOS_BANCO.map(([k]) => html`<td>${x.banco[k] || "—"}</td>`)}
            <td class="acoes-linha"><a class="botao-link botao-pequeno botao-secundario" href="/sistema/favorecidos?editar=${String(x.id)}">Editar</a>
              <form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="id" value="${String(x.id)}"><button class="botao-pequeno botao-secundario" name="acao" value="remover">Remover</button></form></td></tr>`)}</tbody></table></div>`
          : html`<p class="vazio">Nenhum favorecido cadastrado.</p>`}
      </section>
      <script src="/assets/js/mascaras.js" defer></script>`,
  }));
}
