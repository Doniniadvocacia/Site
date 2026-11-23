// Intimações do DJEN: fila de triagem e histórico.
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { opcoes, listasApoio, csrfOk, rotuloProcesso, dataBR } from "./comum.js";
import { formularioPrazo, lerPrazo, gravarPrazo } from "./prazos.js";

const SITUACAO = { pendente: "Pendente", com_prazo: "Prazo criado", sem_prazo: "Sem prazo", importada: "Importada do Wix" };
const trecho = (s, n = 160) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

export async function publicacoes(req, env, sessao, id) {
  if (!id) {
    const visao = new URL(req.url).searchParams.get("visao") || "pendentes";
    const onde = visao === "pendentes" ? "pu.situacao = 'pendente'" : "1 = 1";
    const { results } = await env.DB.prepare(`SELECT pu.id, pu.data_disponibilizacao, pu.data_publicacao, pu.tribunal, pu.tipo, pu.numero_processo,
        pu.processo_id, pu.texto, pu.situacao, pr.pasta FROM publicacoes pu LEFT JOIN processos pr ON pr.id = pu.processo_id
      WHERE ${onde} ORDER BY pu.data_disponibilizacao DESC, pu.id DESC LIMIT 300`).all();
    const aba = (v, r) => html`<a href="/sistema/publicacoes?visao=${v}" class="${visao === v ? "ativa" : ""}">${r}</a>`;
    return resposta(pagina({
      titulo: "Intimações", sessao,
      corpo: html`
        <h1>Intimações do DJEN</h1>
        <nav class="abas">${aba("pendentes", "Para triagem")}${aba("todas", "Todas")}</nav>
        ${results.length ? html`<div class="tabela-rolagem"><table>
          <thead><tr><th>Disponibilização</th><th>Tribunal</th><th>Processo</th><th>Conteúdo</th><th>Situação</th></tr></thead>
          <tbody>${results.map((p) => html`<tr>
            <td class="nowrap"><a href="/sistema/publicacoes/${String(p.id)}">${dataBR(p.data_disponibilizacao)}</a></td>
            <td>${p.tribunal}${p.tipo ? html`<br><small>${p.tipo}</small>` : ""}</td>
            <td>${p.processo_id ? html`<a href="/sistema/processos/${String(p.processo_id)}">${p.pasta ? `Pasta ${p.pasta}` : p.numero_processo}</a>` : html`${p.numero_processo || "—"}<br><small class="alerta-texto">não vinculado</small>`}</td>
            <td><a href="/sistema/publicacoes/${String(p.id)}" class="link-discreto">${trecho(p.texto)}</a></td>
            <td>${SITUACAO[p.situacao]}</td>
          </tr>`)}</tbody>
        </table></div>` : html`<section class="cartao"><p>${visao === "pendentes" ? "Nenhuma intimação aguardando triagem." : "Nenhuma intimação registrada."}</p></section>`}`,
    }));
  }

  const pub = await env.DB.prepare(`SELECT pu.*, pr.pasta, pr.numero, u.nome AS triador FROM publicacoes pu
    LEFT JOIN processos pr ON pr.id = pu.processo_id LEFT JOIN usuarios u ON u.id = pu.triada_por WHERE pu.id = ?`).bind(Number(id)).first();
  if (!pub) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Intimação não encontrada</h1>` }), 404);
  const apoio = await listasApoio(env);
  const { results: prazosPub } = await env.DB.prepare("SELECT id, titulo, prazo_fatal, situacao FROM prazos WHERE publicacao_id = ?").bind(pub.id).all();

  const tela = (p, { erro, calculo } = {}) => resposta(pagina({
    titulo: "Intimação", sessao, erro,
    corpo: html`
      <p class="trilha"><a href="/sistema/publicacoes">Intimações</a></p>
      <h1>Intimação · ${pub.tribunal || ""} ${pub.tipo ? `· ${pub.tipo}` : ""}</h1>
      <section class="cartao">
        <dl class="ficha">
          <div><dt>Disponibilizada em</dt><dd>${dataBR(pub.data_disponibilizacao)}</dd></div>
          <div><dt>Publicada em</dt><dd>${dataBR(pub.data_publicacao)}</dd></div>
          <div><dt>Processo</dt><dd>${pub.numero_processo || "—"}</dd></div>
          <div><dt>Órgão</dt><dd>${pub.orgao || "—"}</dd></div>
          <div><dt>OAB</dt><dd>${pub.oab || "—"}</dd></div>
          <div><dt>Situação</dt><dd>${SITUACAO[pub.situacao]}${pub.triador ? ` · por ${pub.triador}` : ""}</dd></div>
        </dl>
        ${pub.link && /^https:\/\//.test(pub.link) ? html`<p><a href="${pub.link}" rel="noopener noreferrer" target="_blank">Ver no DJEN ↗</a></p>` : ""}
        <h3>Teor</h3><div class="teor">${pub.texto || "(sem texto)"}</div>
      </section>
      ${prazosPub.length ? html`<section class="cartao"><h2>Prazos desta intimação</h2><ul class="lista-simples">${prazosPub.map((x) => html`<li><a href="/sistema/prazos/${String(x.id)}">${x.titulo}</a><span>${dataBR(x.prazo_fatal)} · ${x.situacao}</span></li>`)}</ul></section>` : ""}
      <section class="cartao">
        <h2>${pub.situacao === "pendente" ? "Triagem" : "Criar outro prazo"}</h2>
        ${!pub.processo_id ? html`<p class="alerta-texto">O número do processo não foi encontrado no cadastro. Escolha o processo abaixo, se ele existir.</p>` : ""}
        ${formularioPrazo({
          sessao, apoio, calculo, acao: `/sistema/publicacoes/${String(pub.id)}`,
          p: p || { processo_id: pub.processo_id, data_inicio: pub.data_publicacao, contagem: "uteis", antecedencia: 2, situacao: "aberto", titulo: "", tipo: "Manifestação" },
          botaoSalvar: "Criar prazo",
          extraBotoes: pub.situacao === "pendente" ? html`<button type="submit" name="acao" value="sem_prazo" class="botao-secundario" formnovalidate>Não gera prazo (arquivar)</button>` : "",
        })}
      </section>`,
  }));

  if (req.method === "GET") return tela(null);
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return tela(null, { erro: "Sessão expirada. Tente novamente." });
  const t = agora();

  if (f.get("acao") === "sem_prazo") {
    await env.DB.prepare("UPDATE publicacoes SET situacao = 'sem_prazo', triada_por = ?, triada_em = ?, processo_id = COALESCE(?, processo_id) WHERE id = ?")
      .bind(sessao.usuario_id, t, Number(f.get("processo_id")) || null, pub.id).run();
    await auditar(env, req, sessao.usuario_id, "intimacao_arquivada", `publicação ${pub.id}`);
    return redirecionar("/sistema/publicacoes");
  }
  const { p, calculo } = await lerPrazo(env, f);
  if (f.get("acao") === "calcular") return tela(p, calculo ? { calculo } : { erro: "Para calcular, informe a data da publicação e o número de dias." });
  if (!p.titulo || !p.prazo_fatal) return tela(p, { erro: "Informe o título e o prazo (dias) ou a data fatal." });
  const prazoId = await gravarPrazo(env, p, { usuarioId: sessao.usuario_id, publicacaoId: pub.id });
  await env.DB.prepare("UPDATE publicacoes SET situacao = 'com_prazo', triada_por = ?, triada_em = ?, processo_id = COALESCE(?, processo_id) WHERE id = ?")
    .bind(sessao.usuario_id, t, p.processo_id, pub.id).run();
  await auditar(env, req, sessao.usuario_id, "intimacao_triada", `publicação ${pub.id} → prazo ${prazoId}`);
  return redirecionar("/sistema/publicacoes");
}
