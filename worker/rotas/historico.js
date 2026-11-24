// Histórico processual: andamentos com anexo opcional, exibidos na ficha do processo.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, textoDeHtml } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { salvarAnexo, excluirAnexo, anexosDisponiveis } from "../anexos.js";
import { csrfOk, txt, dataValida, bloco } from "./comum.js";

export const linkAnexo = (a) => (a.anexo_id ? html` <a class="anexo" href="/sistema/anexos/${String(a.anexo_id)}" target="_blank" rel="noopener">📎 ${a.anexo_nome || "anexo"}</a>${a.anexo_pendente ? html` <small>(não copiado do Wix)</small>` : ""}` : "");

// Texto do andamento: HTML de intimações vira texto simples; textos longos ficam recolhidos.
function textoAndamento(descricao) {
  const texto = textoDeHtml(descricao);
  const linhas = texto.split("\n");
  if (texto.length <= 360 && linhas.length <= 5) return html`<p class="pre">${texto}</p>`;
  let resumo = linhas.slice(0, 3).join("\n");
  if (resumo.length > 280) resumo = resumo.slice(0, 280).replace(/\s+\S*$/, "");
  return html`<details class="andamento-longo"><summary><span class="pre">${resumo}…</span> <span class="ver-mais">ver íntegra</span><span class="recolher">recolher</span></summary><p class="pre">${texto}</p></details>`;
}

// Bloco do histórico na ficha do processo (10 por página).
const POR_PAGINA = 10;
export async function cartaoHistorico(env, sessao, processoId, req = null) {
  const total = (await env.DB.prepare("SELECT COUNT(*) AS n FROM historico WHERE processo_id = ?").bind(processoId).first()).n;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pag = Math.min(paginas, Math.max(1, Number(req ? new URL(req.url).searchParams.get("hp") : 1) || 1));
  const { results } = await env.DB.prepare(`SELECT h.*, a.nome AS anexo_nome, (a.chave IS NULL) AS anexo_pendente, u.nome AS autor
    FROM historico h LEFT JOIN anexos a ON a.id = h.anexo_id LEFT JOIN usuarios u ON u.id = h.criado_por
    WHERE h.processo_id = ? ORDER BY h.data DESC, h.id DESC LIMIT ? OFFSET ?`).bind(processoId, POR_PAGINA, (pag - 1) * POR_PAGINA).all();
  const podeAlterar = (h) => sessao.perfil === "admin" || h.criado_por === sessao.usuario_id || !h.criado_por;
  const novo = html`<details class="novo-item"${total ? "" : html` open`}><summary class="botao-link botao-pequeno">Novo histórico</summary>
    <form method="post" action="/sistema/processos/${String(processoId)}/historico" enctype="multipart/form-data" class="formulario grade-form form-historico">
      ${campoCsrf(sessao)}
      <label>Data<input type="date" name="data" required value="${hojeBR()}"></label>
      <label class="largo">Andamento<textarea name="descricao" rows="3" required maxlength="20000" placeholder="Ex.: Juntada de petição; despacho; audiência realizada..."></textarea></label>
      ${anexosDisponiveis(env) ? html`<label class="largo campo-arquivo">Arquivo (até 20 MB)<input type="file" name="arquivo"></label>` : html`<p class="dica largo">Anexos indisponíveis até o R2 ser ativado.</p>`}
      <div class="largo botoes-form"><button type="submit">Adicionar ao histórico</button></div>
    </form></details>`;
  const lista = results.length ? html`<ol class="linha-tempo">${results.map((h) => html`<li>
      <div class="linha-tempo-data">${dataBR(h.data)}</div>
      <div class="linha-tempo-texto">${textoAndamento(h.descricao)}${linkAnexo(h)}
        <div class="linha-tempo-rodape"><small class="dica">${h.autor ? `por ${h.autor}` : h.wix_id ? "importado do Wix" : ""}</small>
        ${podeAlterar(h) ? html`<a class="icone-acao" href="/sistema/historico/${String(h.id)}" title="Editar" aria-label="Editar andamento">✎</a>` : ""}</div>
      </div></li>`)}</ol>` : html`<p class="vazio">Nenhum andamento registrado.</p>`;
  const nav = paginas > 1 ? html`<nav class="paginacao" aria-label="Páginas do histórico">
      ${pag > 1 ? html`<a href="?hp=${String(pag - 1)}#historico" aria-label="Anterior">‹</a>` : html`<span>‹</span>`}
      ${Array.from({ length: paginas }, (_, i) => i + 1).map((n) => n === pag ? html`<strong>${String(n)}</strong>` : html`<a href="?hp=${String(n)}#historico">${String(n)}</a>`)}
      ${pag < paginas ? html`<a href="?hp=${String(pag + 1)}#historico" aria-label="Próxima">›</a>` : html`<span>›</span>`}</nav>` : "";
  return bloco("Histórico da Pasta", html`${novo}${lista}${nav}`, { id: "historico", contagem: total });
}

// Edição de um andamento (autor ou administrador; importados do Wix também podem ser corrigidos).
export async function editarHistorico(req, env, sessao, id) {
  const h = await env.DB.prepare("SELECT h.*, a.nome AS anexo_nome, (a.chave IS NULL) AS anexo_pendente FROM historico h LEFT JOIN anexos a ON a.id = h.anexo_id WHERE h.id = ?").bind(Number(id)).first();
  if (!h) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Andamento não encontrado</h1>` }), 404);
  if (!(sessao.perfil === "admin" || h.criado_por === sessao.usuario_id || !h.criado_por)) return redirecionar(`/sistema/processos/${h.processo_id}?msg=sem_permissao#historico`);
  const tela = (v, erro) => resposta(pagina({
    titulo: "Editar andamento", sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/processos/${String(h.processo_id)}#historico">Voltar ao processo</a></p><h1>Editar andamento</h1>
      <section class="cartao"><form method="post" enctype="multipart/form-data" class="formulario grade-form">${campoCsrf(sessao)}
        <label>Data<input type="date" name="data" required value="${v.data}"></label>
        <label class="largo">Andamento<textarea name="descricao" rows="10" required maxlength="20000">${v.descricao}</textarea></label>
        ${anexosDisponiveis(env) ? html`<label class="largo">${h.anexo_id ? "Substituir arquivo" : "Arquivo (até 20 MB)"}<input type="file" name="arquivo"></label>` : ""}
        ${h.anexo_id ? html`<p class="largo">Arquivo atual:${linkAnexo(h)} <label class="opcao-linha"><input type="checkbox" name="remover_anexo" value="1"> remover</label></p>` : ""}
        <div class="largo botoes-form"><button type="submit">Salvar</button><a class="botao-link botao-secundario" href="/sistema/processos/${String(h.processo_id)}#historico">Cancelar</a></div>
      </form>
      ${sessao.perfil === "admin" ? html`<form method="post" action="/sistema/historico/${String(h.id)}/excluir" class="form-excluir-andamento"
          data-confirmar="Excluir este andamento${h.anexo_id ? " e o arquivo anexado" : ""}? Esta ação não pode ser desfeita.">${campoCsrf(sessao)}
          <input type="hidden" name="confirmar" value="1"><button type="submit" class="botao-perigo">Excluir andamento</button></form>` : ""}</section>
      <script src="/assets/js/confirmar.js" defer></script>`,
  }));
  if (req.method === "GET") return tela({ data: h.data, descricao: textoDeHtml(h.descricao) });
  const { f, ok } = await csrfOk(req, sessao);
  const v = { data: dataValida(txt(f, "data")), descricao: txt(f, "descricao", 20000) };
  if (!ok) return tela({ data: h.data, descricao: h.descricao }, "Sessão expirada. Tente novamente.");
  if (!v.data || !v.descricao) return tela({ data: v.data || h.data, descricao: v.descricao || "" }, "Informe a data e o andamento.");
  let anexoId = h.anexo_id;
  try {
    const novo = await salvarAnexo(env, f.get("arquivo"), "historico", sessao.usuario_id);
    if (novo || f.get("remover_anexo") === "1") { const antigo = anexoId; anexoId = novo; if (antigo) { await env.DB.prepare("UPDATE historico SET anexo_id = NULL WHERE id = ?").bind(h.id).run(); await excluirAnexo(env, antigo); } }
  } catch (e) { return tela(v, e.message); }
  await env.DB.prepare("UPDATE historico SET data = ?, descricao = ?, anexo_id = ?, atualizado_em = ? WHERE id = ?").bind(v.data, v.descricao, anexoId, agora(), h.id).run();
  await auditar(env, req, sessao.usuario_id, "historico_alterado", `historico ${h.id}`);
  return redirecionar(`/sistema/processos/${h.processo_id}?msg=hist_salvo#historico`);
}

export async function adicionarHistorico(req, env, sessao, processoId) {
  const proc = await env.DB.prepare("SELECT id, cliente_id FROM processos WHERE id = ?").bind(Number(processoId)).first();
  if (!proc) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Processo não encontrado</h1>` }), 404);
  const volta = (codigo) => redirecionar(`/sistema/processos/${proc.id}?msg=${codigo}#historico`);
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return volta("sessao");
  const data = dataValida(txt(f, "data")), descricao = txt(f, "descricao", 20000);
  if (!data || !descricao) return volta("hist_vazio");
  let anexoId = null;
  try { anexoId = await salvarAnexo(env, f.get("arquivo"), "historico", sessao.usuario_id); } catch (e) { return volta(/20 MB/.test(e.message) ? "anexo_grande" : "anexo_indisponivel"); }
  await env.DB.prepare("INSERT INTO historico (processo_id, cliente_id, data, descricao, anexo_id, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(proc.id, proc.cliente_id, data, descricao, anexoId, sessao.usuario_id, agora()).run();
  await auditar(env, req, sessao.usuario_id, "historico_criado", `processo ${proc.id}${anexoId ? `, anexo ${anexoId}` : ""}`);
  return volta("hist_ok");
}

export async function excluirHistorico(req, env, sessao, id) {
  const h = await env.DB.prepare("SELECT * FROM historico WHERE id = ?").bind(Number(id)).first();
  const { f, ok } = await csrfOk(req, sessao);
  if (!h) return redirecionar("/sistema/processos");
  const volta = (codigo) => redirecionar(`/sistema/processos/${h.processo_id}?msg=${codigo}#historico`);
  if (!ok || f.get("confirmar") !== "1") return volta("sessao");
  // Exclusão de andamento: somente administradores (feita pela tela de edição, com confirmação).
  if (sessao.perfil !== "admin") return volta("sem_permissao");
  await env.DB.prepare("DELETE FROM historico WHERE id = ?").bind(h.id).run();
  await excluirAnexo(env, h.anexo_id);
  await auditar(env, req, sessao.usuario_id, "historico_excluido", `historico ${h.id} do processo ${h.processo_id}`);
  return volta("hist_excluido");
}

// Mensagens fixas exibidas após redirecionamentos (o texto nunca vem da URL).
export const MENSAGENS = {
  sessao: ["erro", "Sessão expirada. Tente novamente."],
  hist_vazio: ["erro", "Informe a data e o andamento."],
  anexo_grande: ["erro", "O arquivo passa de 20 MB."],
  anexo_indisponivel: ["erro", "Os anexos ainda não estão ativados (R2 do Cloudflare)."],
  hist_ok: ["aviso", "Andamento registrado."],
  sem_permissao: ["erro", "Você não tem permissão para essa ação."],
  hist_excluido: ["aviso", "Andamento excluído."],
  hist_salvo: ["aviso", "Andamento atualizado."],
  salvo: ["aviso", "Alterações salvas."],
};
export function mensagemDaUrl(req) {
  const sp = new URL(req.url).searchParams;
  const m = MENSAGENS[sp.get("msg")] || (sp.get("salvo") ? MENSAGENS.salvo : null);
  return m ? { [m[0]]: m[1] } : {};
}
