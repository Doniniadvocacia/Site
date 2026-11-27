// Intimações do DJEN: fila de triagem e histórico.
import { html, pagina, resposta, redirecionar, campoCsrf, textoDeHtml } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { listasApoio, csrfOk, dataBR, descricaoDaIntimacao } from "./comum.js";
import { formularioPrazo, lerPrazo, gravarPrazo } from "./prazos.js";
import { iaConfigurada, analisarIntimacao, analisarPendentes, lerSugestao } from "../ia.js";
import { calendarioDoBanco } from "../calendario.js";

const SITUACAO = { pendente: "Pendente", com_prazo: "Prazo criado", sem_prazo: "Sem prazo", importada: "Importada do Wix" };
const trecho = (s, n = 160) => { const t = textoDeHtml(s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

const CONFIANCA = { alta: "Confiança alta", media: "Confiança média", baixa: "Confiança baixa" };
const seloConfianca = (s) => html`<span class="${`selo selo-confianca ${s.confianca}`}">${CONFIANCA[s.confianca] || ""}</span>`;
const MENSAGENS = { analise: "Análise das intimações iniciada. As sugestões aparecem em instantes (atualize a página).", aprovada: "Sugestão aprovada.",
  arquivada: "Intimação arquivada sem prazo.", revisar: "Esta sugestão precisa de revisão antes de aprovar: confira os campos e salve.", reanalisada: "Intimação analisada novamente." };

// Monta os campos do formulário de prazo a partir da sugestão da IA.
// Ato com data marcada (audiência, sessão): a data do ato é o prazo fatal; senão, calcula pelos dias a partir da publicação.
const ehEvento = (s) => !!s.data_evento && !s.dias;
function camposDaSugestao(pub, s) {
  const f = new URLSearchParams({ processo_id: pub.processo_id ? String(pub.processo_id) : "", categoria: s.categoria === "Compromisso" ? "Compromisso" : "Prazo",
    tipo: s.tipo || "", titulo: s.titulo || "", contagem: s.contagem, situacao: "aberto", descricao: descricaoSugerida(pub, s) });
  if (ehEvento(s) || s.categoria === "Compromisso") {
    f.set("prazo_fatal", s.data_evento || ""); f.set("prazo_interno", s.data_evento || ""); f.set("hora", s.hora_evento || ""); f.set("antecedencia", "0");
    if (s.categoria === "Prazo") { f.set("data_audiencia", s.data_evento || ""); f.set("hora_audiencia", s.hora_evento || ""); }
  } else { f.set("data_inicio", pub.data_publicacao || ""); f.set("dias", s.dias ? String(s.dias) : ""); f.set("antecedencia", "2"); }
  return f;
}
const descricaoSugerida = (pub, s) => [s.resumo && `Resumo: ${s.resumo}`, s.providencia && `Providência: ${s.providencia}`, descricaoDaIntimacao(pub)].filter(Boolean).join("\n\n").slice(0, 20000);
// Sugestão que pode ser aprovada com um clique (sem campos faltando).
function aprovavel(pub, s) {
  if (!s) return false;
  if (!s.gera_prazo) return true;
  if (!pub.processo_id || !s.tipo) return false;
  return ehEvento(s) || s.categoria === "Compromisso" ? !!s.data_evento : s.dias > 0 && !!pub.data_publicacao;
}

export async function publicacoes(req, env, sessao, id, ctx = null, acaoExtra = null) {
  const url = new URL(req.url);
  if (acaoExtra) return acaoIa(req, env, sessao, id, ctx, acaoExtra);
  if (!id) {
    const visao = url.searchParams.get("visao") || "pendentes";
    const onde = visao === "pendentes" ? "pu.situacao = 'pendente'" : "1 = 1";
    const { results } = await env.DB.prepare(`SELECT pu.id, pu.data_disponibilizacao, pu.data_publicacao, pu.tribunal, pu.tipo, pu.numero_processo,
        pu.processo_id, pu.texto, pu.situacao, pu.ia_status, pu.ia_sugestao, pu.ia_erro, pu.ia_resultado, pr.pasta FROM publicacoes pu LEFT JOIN processos pr ON pr.id = pu.processo_id
      WHERE ${onde} ORDER BY pu.data_disponibilizacao DESC, pu.id DESC LIMIT 300`).all();
    const ia = iaConfigurada(env);
    const semAnalise = results.filter((p) => p.situacao === "pendente" && !p.ia_status).length;
    // Intimações novas ainda sem sugestão: a análise roda em segundo plano enquanto a página abre.
    if (ia && semAnalise && ctx) ctx.waitUntil(analisarPendentes(env).catch((e) => console.error(e)));
    const cal = await calendarioDoBanco(env);
    const colunaIa = (p) => {
      if (p.situacao !== "pendente") return p.ia_resultado ? html`<small class="dica">IA: sugestão ${p.ia_resultado}</small>` : "";
      if (!ia) return "";
      if (p.ia_status === "erro") return html`<small class="alerta-texto">Análise falhou</small>`;
      const s = lerSugestao(p);
      if (!s) return html`<small class="dica">Analisando…</small>`;
      const calc = !ehEvento(s) && s.categoria === "Prazo" && s.dias && p.data_publicacao ? cal.calcular({ dataInicial: p.data_publicacao, dias: s.dias, contagem: s.contagem, antecedencia: 2 }) : null;
      const quando = ehEvento(s) || s.categoria === "Compromisso" ? (s.data_evento ? `${dataBR(s.data_evento)}${s.hora_evento ? ` às ${s.hora_evento}` : ""}` : "data a conferir")
        : calc ? `fatal ${dataBR(calc.fatal)}` : "";
      return html`<div class="sugestao-ia-lista">
        <strong>${s.gera_prazo ? s.titulo || s.tipo : "Não gera prazo"}</strong>${s.urgente ? html` <span class="selo selo-urgente">Urgente</span>` : ""}
        <small>${s.gera_prazo ? [s.categoria === "Prazo" && s.dias ? `${s.dias} dias ${s.contagem === "corridos" ? "corridos" : "úteis"}` : "", quando].filter(Boolean).join(" · ") : s.resumo.slice(0, 90)}</small>
        ${seloConfianca(s)}
        <span class="acoes-sugestao">${aprovavel(p, s) ? html`<form method="post" action="/sistema/publicacoes/${String(p.id)}/aprovar">${campoCsrf(sessao)}
          <button type="submit" class="botao-mini">${s.gera_prazo ? "Aprovar" : "Arquivar"}</button></form>` : ""}
          <a class="botao-mini botao-secundario" href="/sistema/publicacoes/${String(p.id)}">Revisar</a></span></div>`;
    };
    const aba = (v, r) => html`<a href="/sistema/publicacoes?visao=${v}" class="${visao === v ? "ativa" : ""}">${r}</a>`;
    const msg = MENSAGENS[url.searchParams.get("msg")];
    return resposta(pagina({
      titulo: "Intimações", sessao, ...(msg ? { aviso: msg } : {}),
      corpo: html`
        <h1>Intimações do DJEN</h1>
        <nav class="abas">${aba("pendentes", "Para triagem")}${aba("todas", "Todas")}</nav>
        ${ia ? html`<div class="faixa-ia"><span><strong>Análise automática ativa.</strong> Cada intimação nova recebe uma sugestão de prazo da IA. Nada é lançado na agenda sem a sua aprovação.</span>
          ${results.some((p) => p.situacao === "pendente" && p.ia_status !== "pronta") ? html`<form method="post" action="/sistema/publicacoes/analisar">${campoCsrf(sessao)}<button type="submit" class="botao-secundario botao-mini">Analisar pendentes agora</button></form>` : ""}</div>`
          : sessao.perfil === "admin" ? html`<div class="faixa-ia faixa-ia-off">Análise automática por IA desativada: falta cadastrar o segredo <code>ANTHROPIC_API_KEY</code> na Cloudflare.</div>` : ""}
        ${results.length ? html`<div class="tabela-rolagem"><table>
          <thead><tr><th>Disponibilização</th><th>Tribunal</th><th>Processo</th><th>Conteúdo</th>${ia || visao !== "pendentes" ? html`<th>Sugestão da IA</th>` : ""}<th>Situação</th></tr></thead>
          <tbody>${results.map((p) => html`<tr>
            <td class="nowrap"><a href="/sistema/publicacoes/${String(p.id)}">${dataBR(p.data_disponibilizacao)}</a></td>
            <td>${p.tribunal}${p.tipo ? html`<br><small>${p.tipo}</small>` : ""}</td>
            <td>${p.processo_id ? html`<a href="/sistema/processos/${String(p.processo_id)}">${p.pasta ? `Pasta ${p.pasta}` : p.numero_processo}</a>` : html`${p.numero_processo || "—"}<br><small class="alerta-texto">não vinculado</small>`}</td>
            <td><a href="/sistema/publicacoes/${String(p.id)}" class="link-discreto">${trecho(p.texto)}</a></td>
            ${ia || visao !== "pendentes" ? html`<td class="coluna-ia">${colunaIa(p)}</td>` : ""}
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

  const sug = pub.situacao === "pendente" ? lerSugestao(pub) : null;
  let base = null, calcSug = null;
  if (sug && sug.gera_prazo) ({ p: base, calculo: calcSug } = await lerPrazo(env, camposDaSugestao(pub, sug)));
  const cartaoIa = !iaConfigurada(env) || pub.situacao !== "pendente" ? "" : html`<section class="cartao cartao-ia">
      <div class="titulo-acoes"><h2>Sugestão da IA</h2>
        <form method="post" action="/sistema/publicacoes/${String(pub.id)}/analisar">${campoCsrf(sessao)}<button type="submit" class="botao-secundario botao-mini">${sug ? "Analisar de novo" : "Analisar agora"}</button></form></div>
      ${sug ? html`
        <p class="linha-sugestao"><strong>${sug.gera_prazo ? `${sug.categoria}: ${sug.titulo || sug.tipo}` : "Não gera prazo"}</strong> ${seloConfianca(sug)}${sug.urgente ? html` <span class="selo selo-urgente">Urgente</span>` : ""}</p>
        ${sug.gera_prazo ? html`<p class="dica">${!ehEvento(sug) && sug.categoria === "Prazo" ? html`${String(sug.dias || "?")} dias ${sug.contagem === "corridos" ? "corridos" : "úteis"} a partir de ${dataBR(pub.data_publicacao)}${calcSug ? html` → prazo fatal <strong>${dataBR(calcSug.fatal)}</strong>, interno ${dataBR(calcSug.interno)}` : ""}`
          : html`${sug.data_evento ? html`Data: <strong>${dataBR(sug.data_evento)}</strong>${sug.hora_evento ? ` às ${sug.hora_evento}` : ""}` : "Data do ato não identificada: preencha abaixo."}`}</p>` : ""}
        <dl class="ficha ficha-ia">
          <div class="largo"><dt>Resumo</dt><dd>${sug.resumo}</dd></div>
          ${sug.providencia ? html`<div class="largo"><dt>Providência</dt><dd>${sug.providencia}</dd></div>` : ""}
          <div class="largo"><dt>Por quê</dt><dd>${sug.justificativa}</dd></div>
        </dl>
        ${sug.alertas.length ? html`<ul class="alertas-ia">${sug.alertas.map((a) => html`<li>${a}</li>`)}</ul>` : ""}
        <div class="botoes-form">
          ${aprovavel(pub, sug) ? html`<form method="post" action="/sistema/publicacoes/${String(pub.id)}/aprovar">${campoCsrf(sessao)}<button type="submit">${sug.gera_prazo ? "Aprovar sugestão" : "Aprovar e arquivar sem prazo"}</button></form>`
            : html`<span class="dica">Complete os campos do formulário abaixo e clique em "Criar prazo" para aprovar.</span>`}
        </div>
        <p class="nota-ia">O formulário abaixo já está preenchido com a sugestão: se corrigir algo, salve por ele. Sugestão gerada por IA (${sug.modelo || "Claude"}); confira sempre o teor.</p>`
      : pub.ia_status === "erro" ? html`<p class="alerta-texto">A análise falhou: ${pub.ia_erro || "erro desconhecido"}.</p>` : html`<p class="dica">Ainda não analisada.</p>`}
    </section>`;

  const tela = (p, { erro, calculo } = {}) => resposta(pagina({
    titulo: "Intimação", sessao, erro, ...(MENSAGENS[url.searchParams.get("msg")] ? { aviso: MENSAGENS[url.searchParams.get("msg")] } : {}),
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
        <h3>Teor</h3><div class="teor">${textoDeHtml(pub.texto) || "(sem texto)"}</div>
      </section>
      ${cartaoIa}
      ${prazosPub.length ? html`<section class="cartao"><h2>Prazos desta intimação</h2><ul class="lista-simples">${prazosPub.map((x) => html`<li><a href="/sistema/prazos/${String(x.id)}">${x.titulo}</a><span>${dataBR(x.prazo_fatal)} · ${x.situacao}</span></li>`)}</ul></section>` : ""}
      <section class="cartao">
        <h2>${pub.situacao === "pendente" ? "Triagem" : "Criar outro prazo"}</h2>
        ${!pub.processo_id ? html`<p class="alerta-texto">O número do processo não foi encontrado no cadastro. Escolha o processo abaixo, se ele existir.</p>` : ""}
        ${formularioPrazo({
          sessao, apoio, calculo: calculo || (p ? null : calcSug), acao: `/sistema/publicacoes/${String(pub.id)}`,
          p: p || base || { processo_id: pub.processo_id, data_inicio: pub.data_publicacao, contagem: "uteis", antecedencia: 2, situacao: "aberto", titulo: "", tipo: "Manifestação", descricao: descricaoDaIntimacao(pub) },
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
    const resultado = sug ? (sug.gera_prazo ? "rejeitada" : "aprovada") : null;
    await env.DB.prepare("UPDATE publicacoes SET situacao = 'sem_prazo', triada_por = ?, triada_em = ?, processo_id = COALESCE(?, processo_id), ia_resultado = COALESCE(?, ia_resultado) WHERE id = ?")
      .bind(sessao.usuario_id, t, Number(f.get("processo_id")) || null, resultado, pub.id).run();
    await auditar(env, req, sessao.usuario_id, "intimacao_arquivada", `publicação ${pub.id}`);
    return redirecionar("/sistema/publicacoes");
  }
  const { p, calculo } = await lerPrazo(env, f);
  if (f.get("acao") === "calcular") return tela(p, calculo ? { calculo } : { erro: "Para calcular, informe a data da publicação e o número de dias." });
  if (!p.titulo || !p.prazo_fatal) return tela(p, { erro: "Informe o título e o prazo (dias) ou a data fatal." });
  if (!p.descricao) p.descricao = descricaoDaIntimacao(pub);
  const prazoId = await gravarPrazo(env, p, { usuarioId: sessao.usuario_id, publicacaoId: pub.id });
  const igualSugestao = sug && sug.gera_prazo && base && p.tipo === base.tipo && p.prazo_fatal === base.prazo_fatal && (p.categoria || "Prazo") === (base.categoria || "Prazo");
  const resultado = sug ? (igualSugestao ? "aprovada" : sug.gera_prazo ? "corrigida" : "rejeitada") : null;
  await env.DB.prepare("UPDATE publicacoes SET situacao = 'com_prazo', triada_por = ?, triada_em = ?, processo_id = COALESCE(?, processo_id), ia_resultado = COALESCE(?, ia_resultado) WHERE id = ?")
    .bind(sessao.usuario_id, t, p.processo_id, resultado, pub.id).run();
  await auditar(env, req, sessao.usuario_id, "intimacao_triada", `publicação ${pub.id} → prazo ${prazoId}`);
  return redirecionar("/sistema/publicacoes");
}

// Ações da IA: analisar todas as pendentes, analisar uma de novo e aprovar uma sugestão com um clique.
async function acaoIa(req, env, sessao, id, ctx, acao) {
  if (req.method !== "POST") return redirecionar(id ? `/sistema/publicacoes/${id}` : "/sistema/publicacoes");
  const { ok } = await csrfOk(req, sessao);
  if (!ok) return redirecionar(id ? `/sistema/publicacoes/${id}` : "/sistema/publicacoes");
  if (acao === "analisar" && !id) {
    if (iaConfigurada(env)) {
      // Repete também as que falharam (zera o contador de tentativas).
      await env.DB.prepare("UPDATE publicacoes SET ia_status = NULL, ia_tentativas = 0 WHERE situacao = 'pendente' AND ia_status = 'erro'").run();
      const tarefa = analisarPendentes(env, 30).catch((e) => console.error(e));
      if (ctx) ctx.waitUntil(tarefa); else await tarefa;
    }
    return redirecionar("/sistema/publicacoes?msg=analise");
  }
  const pub = await env.DB.prepare("SELECT * FROM publicacoes WHERE id = ?").bind(Number(id)).first();
  if (!pub) return redirecionar("/sistema/publicacoes");
  if (acao === "analisar") {
    if (iaConfigurada(env) && pub.situacao === "pendente") { try { await analisarIntimacao(env, pub.id); } catch { /* erro já gravado e exibido na página */ } }
    return redirecionar(`/sistema/publicacoes/${pub.id}?msg=reanalisada`);
  }
  // aprovar
  const s = pub.situacao === "pendente" ? lerSugestao(pub) : null;
  if (!aprovavel(pub, s)) return redirecionar(`/sistema/publicacoes/${pub.id}?msg=revisar`);
  const t = agora();
  if (!s.gera_prazo) {
    await env.DB.prepare("UPDATE publicacoes SET situacao = 'sem_prazo', triada_por = ?, triada_em = ?, ia_resultado = 'aprovada' WHERE id = ? AND situacao = 'pendente'")
      .bind(sessao.usuario_id, t, pub.id).run();
    await auditar(env, req, sessao.usuario_id, "intimacao_arquivada", `publicação ${pub.id} (sugestão da IA aprovada)`);
    return redirecionar("/sistema/publicacoes?msg=arquivada");
  }
  const { p } = await lerPrazo(env, camposDaSugestao(pub, s));
  if (!p.prazo_fatal || !p.tipo) return redirecionar(`/sistema/publicacoes/${pub.id}?msg=revisar`);
  if (!p.titulo) p.titulo = p.tipo;
  // Evita prazo em dobro se dois usuários aprovarem ao mesmo tempo.
  const r = await env.DB.prepare("UPDATE publicacoes SET situacao = 'com_prazo', triada_por = ?, triada_em = ?, ia_resultado = 'aprovada' WHERE id = ? AND situacao = 'pendente'")
    .bind(sessao.usuario_id, t, pub.id).run();
  if (!r.meta.changes) return redirecionar("/sistema/publicacoes");
  const prazoId = await gravarPrazo(env, p, { usuarioId: sessao.usuario_id, publicacaoId: pub.id });
  await auditar(env, req, sessao.usuario_id, "intimacao_triada", `publicação ${pub.id} → prazo ${prazoId} (sugestão da IA aprovada)`);
  return redirecionar("/sistema/publicacoes?msg=aprovada");
}
