// Histórico processual: andamentos com anexo opcional, exibidos na ficha do processo.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, textoDeHtml } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { salvarAnexo, excluirAnexo, anexosDisponiveis } from "../anexos.js";
import { csrfOk, txt, dataValida } from "./comum.js";

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

// Cartão do histórico na ficha do processo.
export async function cartaoHistorico(env, sessao, processoId) {
  const { results } = await env.DB.prepare(`SELECT h.*, a.nome AS anexo_nome, (a.chave IS NULL) AS anexo_pendente, u.nome AS autor
    FROM historico h LEFT JOIN anexos a ON a.id = h.anexo_id LEFT JOIN usuarios u ON u.id = h.criado_por
    WHERE h.processo_id = ? ORDER BY h.data DESC, h.id DESC`).bind(processoId).all();
  const podeExcluir = (h) => sessao.perfil === "admin" || h.criado_por === sessao.usuario_id;
  return html`<section class="cartao" id="historico"><h2>Histórico</h2>
    <form method="post" action="/sistema/processos/${String(processoId)}/historico" enctype="multipart/form-data" class="formulario grade-form form-historico">
      ${campoCsrf(sessao)}
      <label>Data<input type="date" name="data" required value="${hojeBR()}"></label>
      <label class="largo">Andamento<textarea name="descricao" rows="2" required maxlength="8000" placeholder="Ex.: Juntada de petição; despacho; audiência realizada..."></textarea></label>
      ${anexosDisponiveis(env) ? html`<label>Anexo (até 20 MB)<input type="file" name="arquivo"></label>` : html`<p class="dica">Anexos indisponíveis até o R2 ser ativado.</p>`}
      <div class="botoes-form"><button type="submit">Adicionar ao histórico</button></div>
    </form>
    ${results.length ? html`<ol class="linha-tempo">${results.map((h) => html`<li>
      <div class="linha-tempo-data">${dataBR(h.data)}</div>
      <div class="linha-tempo-texto">${textoAndamento(h.descricao)}${linkAnexo(h)}
        <small class="dica">${h.autor ? `por ${h.autor}` : h.wix_id ? "importado do Wix" : ""}</small>
        ${podeExcluir(h) ? html`<form method="post" action="/sistema/historico/${String(h.id)}/excluir" class="form-linha form-excluir">${campoCsrf(sessao)}
          <label class="confirmar"><input type="checkbox" name="confirmar" value="1" required> confirmar</label><button type="submit" class="botao-pequeno botao-secundario">Excluir</button></form>` : ""}
      </div></li>`)}</ol>` : html`<p class="vazio">Nenhum andamento registrado.</p>`}
  </section>`;
}

export async function adicionarHistorico(req, env, sessao, processoId) {
  const proc = await env.DB.prepare("SELECT id, cliente_id FROM processos WHERE id = ?").bind(Number(processoId)).first();
  if (!proc) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Processo não encontrado</h1>` }), 404);
  const volta = (codigo) => redirecionar(`/sistema/processos/${proc.id}?msg=${codigo}#historico`);
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return volta("sessao");
  const data = dataValida(txt(f, "data")), descricao = txt(f, "descricao", 8000);
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
  if (!ok || f.get("confirmar") !== "1") return volta("confirmar");
  if (sessao.perfil !== "admin" && h.criado_por !== sessao.usuario_id) return volta("sem_permissao");
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
  confirmar: ["erro", "Marque “confirmar” para excluir."],
  sem_permissao: ["erro", "Você não tem permissão para essa ação."],
  hist_excluido: ["aviso", "Andamento excluído."],
  salvo: ["aviso", "Alterações salvas."],
};
export function mensagemDaUrl(req) {
  const sp = new URL(req.url).searchParams;
  const m = MENSAGENS[sp.get("msg")] || (sp.get("salvo") ? MENSAGENS.salvo : null);
  return m ? { [m[0]]: m[1] } : {};
}
