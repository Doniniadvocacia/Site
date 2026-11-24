// Minha conta: edição do cadastro pessoal do usuário logado.
import { html, pagina, resposta, campoCsrf } from "../html.js";
import { agora, cifrar, decifrar, conferirSenha } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt, dataValida } from "./comum.js";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const PERFIS = { admin: "Administrador", advogado: "Advogado", colaborador: "Colaborador" };
const CARGOS = ["Advogado(a) titular", "Advogado(a) associado(a)", "Advogado(a)", "Estagiário(a)", "Assistente jurídico(a)", "Secretário(a)", "Financeiro", "Administrativo"];
const ENC = ["celular", "telefone", "cpf", "nascimento"];
const END = ["rua", "numero", "complemento", "bairro", "cidade", "uf", "cep"];
// Telefones e CEP: guarda formatado; aceita só a quantidade certa de dígitos.
const fmt = {
  celular: (d) => `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`,
  telefone: (d) => `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`,
  cep: (d) => `${d.slice(0, 5)}-${d.slice(5)}`,
};

function cpfValido(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dig = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

export async function editarCadastro(req, env, sessao) {
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(sessao.usuario_id).first();
  const tela = (v, { erro, aviso } = {}, status = 200) => resposta(pagina({
    titulo: "Editar cadastro", sessao, erro, aviso,
    corpo: html`<h1>Editar cadastro</h1>
      <section class="cartao">
        <form method="post" class="formulario grade-form form-cadastro">
          ${campoCsrf(sessao)}
          <fieldset class="largo grade-form grupo-form"><legend>Dados pessoais</legend>
            <label class="duplo">Nome completo<input name="nome" required maxlength="120" value="${v.nome || ""}" autocomplete="name"></label>
            <label>CPF<input name="cpf" maxlength="14" inputmode="numeric" data-mascara="cpf" value="${v.cpf || ""}" placeholder="000.000.000-00"></label>
            <label>Data de nascimento<input type="date" name="nascimento" value="${v.nascimento || ""}"></label>
          </fieldset>
          <fieldset class="largo grade-form grupo-form"><legend>Contato</legend>
            <label class="duplo">E-mail (usado para entrar)<input type="email" name="email" required maxlength="200" value="${v.email || ""}" autocomplete="email"></label>
            <label>Celular / WhatsApp<input name="celular" maxlength="15" inputmode="tel" data-mascara="celular" value="${v.celular || ""}" placeholder="(XX) XXXXX-XXXX" autocomplete="tel"></label>
            <label>Telefone fixo<input name="telefone" maxlength="14" inputmode="tel" data-mascara="telefone" value="${v.telefone || ""}" placeholder="(XX) XXXX-XXXX"></label>
          </fieldset>
          <fieldset class="largo grade-form grupo-form grupo-endereco"><legend>Endereço</legend>
            <label class="duplo">Rua<input name="rua" maxlength="150" value="${v.rua || ""}" autocomplete="address-line1"></label>
            <label>Número<input name="numero" maxlength="15" value="${v.numero || ""}"></label>
            <label>Complemento<input name="complemento" maxlength="80" value="${v.complemento || ""}" placeholder="Apto, sala, bloco" autocomplete="address-line2"></label>
            <label>Bairro<input name="bairro" maxlength="80" value="${v.bairro || ""}"></label>
            <label>Cidade<input name="cidade" maxlength="80" value="${v.cidade || ""}" autocomplete="address-level2"></label>
            <label>Estado<select name="uf" autocomplete="address-level1"><option value="">—</option>${UFS.map((x) => html`<option value="${x}"${x === v.uf ? html` selected` : ""}>${x}</option>`)}</select></label>
            <label>CEP<input name="cep" maxlength="9" inputmode="numeric" data-mascara="cep" value="${v.cep || ""}" placeholder="XXXXX-XXX" autocomplete="postal-code"></label>
          </fieldset>
          <fieldset class="largo grade-form grupo-form"><legend>Dados profissionais</legend>
            <label class="duplo">Cargo / função<input name="cargo" maxlength="80" value="${v.cargo || ""}" list="l-cargos"></label>
            <label>OAB (número)<input name="oab_numero" maxlength="12" inputmode="numeric" value="${v.oab_numero || ""}"></label>
            <label>OAB (UF)<select name="oab_uf"><option value="">—</option>${UFS.map((x) => html`<option value="${x}"${x === v.oab_uf ? html` selected` : ""}>${x}</option>`)}</select></label>
            <p class="dica largo">Perfil de acesso: <strong>${PERFIS[u.perfil] || u.perfil}</strong>${u.perfil === "admin" || u.acesso_financeiro ? " · com acesso ao Financeiro" : ""}. O perfil é alterado por um administrador.</p>
          </fieldset>
          <label class="duplo campo-senha-atual">Senha atual <small>(obrigatória só para trocar o e-mail)</small><input type="password" name="senha_atual" autocomplete="current-password"></label>
          <div class="largo botoes-form"><button type="submit">Salvar cadastro</button><a class="botao-link botao-secundario" href="/sistema/">Cancelar</a></div>
          <datalist id="l-cargos">${CARGOS.map((c) => html`<option value="${c}">`)}</datalist>
        </form>
        <p class="dica">CPF, data de nascimento, telefones e endereço são gravados cifrados.</p>
      </section>
      <script src="/assets/js/mascaras.js" defer></script>`,
  }), status);

  if (req.method === "GET") {
    const dec = await Promise.all(ENC.map((k) => decifrar(env, u[`${k}_enc`])));
    const v = { ...u }; ENC.forEach((k, i) => (v[k] = dec[i]));
    try { Object.assign(v, JSON.parse((await decifrar(env, u.endereco_enc)) || "{}")); } catch { /* sem endereço */ }
    return tela(v);
  }
  const { f, ok } = await csrfOk(req, sessao);
  const v = {
    nome: txt(f, "nome", 120), email: (txt(f, "email", 200) || "").toLowerCase(), cargo: txt(f, "cargo", 80),
    oab_numero: (txt(f, "oab_numero", 12) || "").replace(/\D/g, "") || null, oab_uf: UFS.includes(f.get("oab_uf")) ? f.get("oab_uf") : null,
    celular: txt(f, "celular", 20), telefone: txt(f, "telefone", 20), cpf: txt(f, "cpf", 14), nascimento: dataValida(txt(f, "nascimento")),
    rua: txt(f, "rua", 150), numero: txt(f, "numero", 15), complemento: txt(f, "complemento", 80), bairro: txt(f, "bairro", 80),
    cidade: txt(f, "cidade", 80), uf: UFS.includes(f.get("uf")) ? f.get("uf") : null, cep: txt(f, "cep", 9),
  };
  if (!ok) return tela(v, { erro: "Sessão expirada. Tente novamente." }, 403);
  if (!v.nome) return tela(v, { erro: "Informe o nome completo." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return tela(v, { erro: "Informe um e-mail válido." }, 400);
  if (v.cpf && !cpfValido(v.cpf)) return tela(v, { erro: "CPF inválido." }, 400);
  for (const [campo, n, rotulo] of [["celular", 11, "Celular: use (XX) XXXXX-XXXX."], ["telefone", 10, "Telefone fixo: use (XX) XXXX-XXXX."], ["cep", 8, "CEP: use XXXXX-XXX."]]) {
    if (!v[campo]) continue;
    const d = v[campo].replace(/\D/g, "");
    if (d.length !== n) return tela(v, { erro: rotulo }, 400);
    v[campo] = fmt[campo](d);
  }
  if (v.cpf) { const d = v.cpf.replace(/\D/g, ""); v.cpf = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`; }
  if (v.nascimento && v.nascimento > new Date().toISOString().slice(0, 10)) return tela(v, { erro: "Data de nascimento inválida." }, 400);
  const trocouEmail = v.email !== String(u.email).toLowerCase();
  if (trocouEmail) {
    if (!(await conferirSenha(String(f.get("senha_atual") || ""), u.senha_hash))) return tela(v, { erro: "Para trocar o e-mail, informe sua senha atual." }, 400);
    const existe = await env.DB.prepare("SELECT id FROM usuarios WHERE email = ? AND id != ?").bind(v.email, u.id).first();
    if (existe) return tela(v, { erro: "Já existe um usuário com esse e-mail." }, 400);
  }
  const enc = await Promise.all(ENC.map((k) => cifrar(env, v[k])));
  const endereco = Object.fromEntries(END.filter((k) => v[k]).map((k) => [k, v[k]]));
  const endEnc = Object.keys(endereco).length ? await cifrar(env, JSON.stringify(endereco)) : null;
  await env.DB.prepare(`UPDATE usuarios SET nome = ?, email = ?, cargo = ?, oab_numero = ?, oab_uf = ?, celular_enc = ?, telefone_enc = ?, cpf_enc = ?,
      nascimento_enc = ?, endereco_enc = ?, atualizado_em = ? WHERE id = ?`)
    .bind(v.nome, v.email, v.cargo, v.oab_numero, v.oab_uf, ...enc, endEnc, agora(), u.id).run();
  await auditar(env, req, u.id, "cadastro_alterado", trocouEmail ? `e-mail: ${u.email} → ${v.email}` : "dados pessoais");
  sessao.nome = v.nome;
  return tela(v, { aviso: "Cadastro atualizado." });
}
