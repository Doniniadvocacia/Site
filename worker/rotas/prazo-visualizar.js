// Prazo/compromisso já cadastrado: modo visualização (sem edição dos campos).
// Ações permitidas: cumprir, reagendar o prazo interno (até o fatal; compromissos para qualquer data, exceto sessão de
// julgamento) e cancelar com motivo. Também fornece os dados do pop-up das etiquetas do calendário.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, textoDeHtml } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { obterLista } from "../listas.js";
import { csrfOk, txt, dataValida, dataTravada, urgencia, opcoes, descricaoDaIntimacao } from "./comum.js";

const SITUACAO = { aberto: "Pendente", cumprido: "Cumprido", cancelado: "Cancelado", agendado: "Agendado", realizado: "Realizado" };
const quando = (s) => (s && Number(s) > 1e9 ? new Date((Number(s) - 3 * 3600) * 1000).toISOString().slice(0, 10).split("-").reverse().join("/") : "");
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Lê o item (prazo/compromisso da tabela prazos, ou compromisso avulso da tabela agenda) com a pasta e o cliente.
export async function lerItem(env, tipo, id) {
  const tabela = tipo === "agenda" ? "agenda" : "prazos";
  const item = await env.DB.prepare(`SELECT x.*, u.nome AS criado_por_nome FROM ${tabela} x LEFT JOIN usuarios u ON u.id = x.criado_por WHERE x.id = ?`).bind(Number(id)).first();
  if (!item) return null;
  // Prazos antigos gerados de intimação, sem descrição: mostra o teor da intimação.
  if (tabela === "prazos" && !item.descricao && item.publicacao_id) {
    const pub = await env.DB.prepare("SELECT * FROM publicacoes WHERE id = ?").bind(item.publicacao_id).first();
    if (pub) item.descricao = descricaoDaIntimacao(pub);
  }
  const proc = item.processo_id ? await env.DB.prepare(`SELECT p.*, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`).bind(item.processo_id).first() : null;
  const comprovante = item.comprovante_anexo_id ? await env.DB.prepare("SELECT nome FROM anexos WHERE id = ?").bind(item.comprovante_anexo_id).first() : null;
  return { tipo: tabela === "agenda" ? "agenda" : "prazo", item, proc, comprovante_nome: comprovante?.nome || null };
}

// Campos dos dois blocos (Pasta e Agenda), no mesmo formato para a página e para o pop-up.
export function blocosDoItem({ tipo, item, proc }) {
  const comp = tipo === "agenda" || item.categoria === "Compromisso";
  const pasta = proc ? [
    ["Pasta", proc.pasta], ["Adv. responsável", proc.advogado_responsavel], ["Data do cadastro", dataBR(proc.data_cadastro)],
    ["Cliente", proc.cliente_nome], ["Parte contrária", proc.parte_contraria], ["Status da pasta", proc.situacao],
    ["Nº do processo", proc.numero], ["Órgão julgador", proc.vara], ["Tipo de ação", proc.tipo_acao],
    ["Comarca", [proc.comarca, proc.uf].filter(Boolean).join(" / ")], ["Fase processual", proc.fase], ["Competência", proc.competencia],
  ].filter(([, v]) => v) : [];
  const agenda = tipo === "agenda" ? [
    ["Agrupamento", "Compromisso"], ["Tipo", item.tipo || item.titulo], ["Situação", SITUACAO[item.situacao] || item.situacao],
    ["Data", dataBR(item.data)], ["Hora", item.hora], ["Local", item.local], ["Cadastrado por", item.criado_por_nome],
  ] : [
    ["Agrupamento", comp ? "Compromisso" : "Prazo"], ["Tipo", item.tipo || item.titulo], ["Situação", SITUACAO[item.situacao] || item.situacao],
    ["Responsável", item.responsavel], [comp ? "Data" : "Prazo interno", dataBR(item.prazo_interno || item.prazo_fatal)],
    ...(comp ? [["Hora", item.hora]] : [["Prazo fatal", dataBR(item.prazo_fatal)]]),
    ...(item.data_audiencia ? [["Audiência", `${dataBR(item.data_audiencia)}${item.hora_audiencia ? ` ${item.hora_audiencia}` : ""}`]] : []),
    ...(item.data_inicio && item.dias ? [["Contagem", `${item.dias} dias ${item.contagem === "corridos" ? "corridos" : "úteis"} a partir de ${dataBR(item.data_inicio)}`]] : []),
    ["Cadastrado em", `${quando(item.criado_em)}${item.criado_por_nome ? ` por ${item.criado_por_nome}` : ""}`],
    ...(item.situacao === "cumprido" ? [["Cumprido em", dataBR(item.data_cumprimento)]] : []),
    ...(item.situacao === "cancelado" ? [["Cancelado em", quando(item.cancelado_em)], ["Motivo do cancelamento", item.motivo_cancelamento]] : []),
  ];
  return {
    comp,
    blocos: [...(pasta.length ? [{ titulo: "Pasta", campos: pasta }] : []), { titulo: comp ? "Compromisso" : "Prazo", campos: agenda.filter(([, v]) => v) }],
    descricao: textoDeHtml(tipo === "agenda" ? item.observacoes : item.descricao) || "",
  };
}

// Pop-up do calendário: GET /sistema/agenda/detalhe?c=prazo:12 (ou agenda:5)
export async function detalheJson(req, env) {
  const c = new URL(req.url).searchParams.get("c") || "";
  const m = /^(prazo|agenda):(\d+)$/.exec(c);
  if (!m) return json({ ok: false }, 400);
  const dados = await lerItem(env, m[1], m[2]);
  if (!dados) return json({ ok: false }, 404);
  const { comp, blocos, descricao } = blocosDoItem(dados);
  return json({
    ok: true, titulo: dados.item.titulo, comp, blocos, descricao: descricao.length > 1200 ? `${descricao.slice(0, 1200)}…` : descricao,
    link: m[1] === "agenda" ? `/sistema/agenda/${dados.item.id}` : `/sistema/prazos/${dados.item.id}`,
    processo: dados.proc ? `/sistema/processos/${dados.proc.id}` : null,
  });
}

const fichaHtml = (campos) => html`<dl class="ficha">${campos.map(([r, v]) => html`<div><dt>${r}</dt><dd>${v}</dd></div>`)}</dl>`;

export async function visualizarPrazo(req, env, sessao, item, { erro = null, aviso = null } = {}) {
  const dados = await lerItem(env, "prazo", item.id);
  const { comp, blocos, descricao } = blocosDoItem(dados);
  const sp = new URL(req.url).searchParams;
  const msg = sp.get("msg") || (sp.get("salvo") ? "salvo" : null);
  const avisos = { salvo: comp ? "Compromisso salvo." : "Prazo salvo.", reagendado: comp ? "Compromisso reagendado." : "Prazo interno reagendado.", cancelado: comp ? "Compromisso cancelado." : "Prazo cancelado.", cumprido: "Marcado como cumprido." };
  const erros = { sessao: "Sessão expirada. Tente novamente.", fatal: `O prazo interno não pode passar do prazo fatal (${dataBR(item.prazo_fatal)}).`, data: "Informe uma data válida.",
    travado: "Sessão de julgamento tem data fixada e não pode ser reagendada.", motivo: "Escolha o motivo do cancelamento.", outro: "Descreva o motivo em \"Detalhes\".",
    fechado: "Este item não está mais em aberto.", anexo: `Não foi possível anexar o comprovante: ${sp.get("m") || "erro no envio"}. O prazo continua em aberto.`, edicao: "Prazos e compromissos cadastrados não podem ser editados. Use cumprir, reagendar ou cancelar." };
  const aberto = item.situacao === "aberto";
  const travado = dataTravada(item);
  const motivos = await obterLista(env, "motivo_cancelamento_prazo");
  const hoje = hojeBR();
  const acoes = aberto ? html`<section class="cartao acoes-prazo" id="acoes"><h2>Ações</h2><div class="acoes-prazo-grade">
      <form method="post" action="/sistema/prazos/${String(item.id)}/cumprir" class="acao-prazo" enctype="multipart/form-data">${campoCsrf(sessao)}<input type="hidden" name="voltar" value="item">
        <h3>Cumprir</h3><p class="dica">Marca como cumprido hoje (${dataBR(hoje)}).</p>
        <label>${comp ? "Comprovante" : "Comprovante de protocolo"} <small>(opcional)</small><input type="file" name="comprovante" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"></label>
        <button type="submit">Marcar como cumprido</button></form>
      <form method="post" action="/sistema/prazos/${String(item.id)}/reagendar" class="acao-prazo">${campoCsrf(sessao)}
        <h3>${comp ? "Reagendar" : "Reagendar prazo interno"}</h3>
        ${travado ? html`<p class="dica">Sessão de julgamento: a data é fixada pelo tribunal e não pode ser alterada.</p>`
          : html`<p class="dica">${comp ? "Escolha a nova data do compromisso." : `Até o prazo fatal (${dataBR(item.prazo_fatal)}).`}</p>
            <label>Nova data<input type="date" name="data" required value="${item.prazo_interno || item.prazo_fatal || ""}"${comp ? "" : html` max="${item.prazo_fatal || ""}"`}></label>
            <button type="submit" class="botao-secundario">Reagendar</button>`}</form>
      <form method="post" action="/sistema/prazos/${String(item.id)}/cancelar" class="acao-prazo" data-confirmar="${`Cancelar ${comp ? "este compromisso" : "este prazo"}? Ele sai da agenda e fica registrado como cancelado.`}">${campoCsrf(sessao)}
        <h3>Cancelar</h3>
        <label>Motivo<select name="motivo" required>${opcoes(motivos.map((x) => [x, x]), "", "Selecione…")}</select></label>
        <label>Detalhes<input name="detalhe" maxlength="300" placeholder="Obrigatório se o motivo for Outro"></label>
        <button type="submit" class="botao-perigo">Cancelar ${comp ? "compromisso" : "prazo"}</button></form>
    </div></section>` : "";
  return resposta(pagina({
    titulo: item.titulo, sessao, erro: erro || erros[msg] || null, aviso: aviso || avisos[msg] || null,
    corpo: html`<p class="trilha"><a href="/sistema/agenda?visao=${comp ? "lista" : "prazos"}">Agenda › ${comp ? "Compromissos" : "Prazos"}</a></p>
      <div class="titulo-acoes"><h1>${item.titulo} <span class="${`selo ${item.situacao === "cumprido" ? "selo-pago" : item.situacao === "cancelado" ? "selo-perdido" : comp ? "selo-compromisso" : "selo-prazo"}`}">${SITUACAO[item.situacao] || item.situacao}</span></h1>
        ${dados.proc ? html`<a class="botao-link botao-secundario" href="/sistema/processos/${String(dados.proc.id)}">Abrir processo</a>` : ""}</div>
      ${item.publicacao_id ? html`<p class="subtitulo">Criado a partir de <a href="/sistema/publicacoes/${String(item.publicacao_id)}">intimação do DJEN</a></p>` : ""}
      ${aberto && !comp && item.prazo_fatal ? html`<p class="urgencia-prazo">Prazo fatal ${dataBR(item.prazo_fatal)} ${urgencia(item.prazo_fatal, item.situacao)}</p>` : ""}
      ${blocos.map((b) => html`<section class="cartao bloco-visualizacao"><h2>${b.titulo}</h2>${fichaHtml(b.campos)}</section>`)}
      ${descricao ? html`<section class="cartao bloco-visualizacao"><h2>Descrição</h2><p class="pre">${descricao}</p></section>` : ""}
      ${item.comprovante_anexo_id ? html`<section class="cartao bloco-visualizacao"><h2>${comp ? "Comprovante" : "Comprovante de protocolo"}</h2>
        <p><a class="anexo" href="/sistema/anexos/${String(item.comprovante_anexo_id)}" target="_blank" rel="noopener">📎 ${dados.comprovante_nome || "Abrir comprovante"}</a></p></section>` : ""}
      ${acoes}
      <script src="/assets/js/confirmar.js" defer></script>`,
  }));
}

// POST /sistema/prazos/:id/reagendar | /cancelar
export async function acaoVisualizacao(req, env, sessao, id, acao) {
  const pid = Number(id);
  const volta = (msg) => redirecionar(`/sistema/prazos/${pid}?msg=${msg}${msg === "reagendado" || msg === "cancelado" ? "" : "#acoes"}`);
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return volta("sessao");
  const pz = await env.DB.prepare("SELECT * FROM prazos WHERE id = ?").bind(pid).first();
  if (!pz) return redirecionar("/sistema/agenda");
  if (pz.situacao !== "aberto") return volta("fechado");
  const t = agora();
  if (acao === "reagendar") {
    if (dataTravada(pz)) return volta("travado");
    const nova = dataValida(txt(f, "data"));
    if (!nova) return volta("data");
    if (pz.categoria === "Compromisso") {
      await env.DB.prepare("UPDATE prazos SET prazo_interno = ?1, prazo_fatal = ?1, atualizado_em = ?2 WHERE id = ?3").bind(nova, t, pid).run();
      await auditar(env, req, sessao.usuario_id, "compromisso_reagendado", `compromisso ${pid}: ${pz.prazo_interno || pz.prazo_fatal || "-"} → ${nova}`);
      return volta("reagendado");
    }
    if (!pz.prazo_fatal || nova > pz.prazo_fatal) return volta("fatal");
    await env.DB.prepare("UPDATE prazos SET prazo_interno = ?, atualizado_em = ? WHERE id = ?").bind(nova, t, pid).run();
    await auditar(env, req, sessao.usuario_id, "prazo_reprogramado", `prazo ${pid}: interno ${pz.prazo_interno || "-"} → ${nova}`);
    return volta("reagendado");
  }
  if (acao === "cancelar") {
    const motivo = txt(f, "motivo", 120), detalhe = txt(f, "detalhe", 300);
    if (!motivo) return volta("motivo");
    if (/^outro$/i.test(motivo) && !detalhe) return volta("outro");
    const texto = detalhe ? `${motivo} — ${detalhe}` : motivo;
    await env.DB.prepare("UPDATE prazos SET situacao = 'cancelado', motivo_cancelamento = ?, cancelado_em = ?, cancelado_por = ?, atualizado_em = ? WHERE id = ?")
      .bind(texto, t, sessao.usuario_id, t, pid).run();
    await auditar(env, req, sessao.usuario_id, "prazo_cancelado", `prazo ${pid}: ${texto}`);
    return volta("cancelado");
  }
  return volta("dados");
}
