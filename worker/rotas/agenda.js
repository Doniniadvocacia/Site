// Agenda de compromissos (audiências, reuniões, diligências).
import { html, pagina, resposta, redirecionar, campoCsrf, seguro } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR, somarDias, feriadosNacionais } from "../calendario.js";
import { opcoes, listasApoio, csrfOk, txt, dataValida, dataBR } from "./comum.js";

const SITUACOES = [["agendado", "Agendado"], ["realizado", "Realizado"], ["cancelado", "Cancelado"]];


// ---------- Calendário mensal ----------
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_POR_DIA = 12;
// Cores por tipo de prazo (o mesmo tipo sempre recebe a mesma cor).
// As cores ficam no CSS (classes cor-0 a cor-9), pois a política de segurança não permite estilo embutido.
const CORES = 10;
function corDoTipo(tipo) {
  if (!tipo) return "cor-0";
  let h = 0; for (const c of tipo.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `cor-${h % CORES}`;
}

async function itensDoPeriodo(env, inicio, fim) {
  const [{ results: prz }, { results: ags }, { results: locais }] = await Promise.all([
    env.DB.prepare(`SELECT p.id, p.titulo, p.tipo, COALESCE(p.prazo_interno, p.prazo_fatal) AS data, p.prazo_fatal, p.hora, p.situacao, pr.pasta FROM prazos p
      LEFT JOIN processos pr ON pr.id = p.processo_id WHERE COALESCE(p.prazo_interno, p.prazo_fatal) BETWEEN ? AND ? AND p.situacao != 'cancelado'
      ORDER BY 4, p.situacao, p.hora`).bind(inicio, fim).all(),
    env.DB.prepare(`SELECT a.id, a.titulo, a.tipo, a.data, a.hora, a.situacao, pr.pasta FROM agenda a
      LEFT JOIN processos pr ON pr.id = a.processo_id WHERE a.data BETWEEN ? AND ? AND a.situacao != 'cancelado' ORDER BY a.data, a.hora`).bind(inicio, fim).all(),
    env.DB.prepare("SELECT data, descricao FROM feriados WHERE data BETWEEN ? AND ?").bind(inicio, fim).all(),
  ]);
  const porDia = new Map();
  const add = (d, it) => { if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(it); };
  for (const a of ags) add(a.data, { ...a, href: `/sistema/agenda/${a.id}`, cor: "cor-compromisso", feito: a.situacao === "realizado", compromisso: true });
  for (const p of prz) add(p.data, { ...p, href: `/sistema/prazos/${p.id}`, cor: corDoTipo(p.tipo), feito: p.situacao === "cumprido", prazo: true });
  const feriados = new Map(locais.map((f) => [f.data, f.descricao]));
  for (const ano of new Set([inicio.slice(0, 4), fim.slice(0, 4)])) for (const [d, n] of feriadosNacionais(Number(ano))) if (!feriados.has(d)) feriados.set(d, n);
  return { porDia, feriados, tipos: [...new Set(prz.map((p) => p.tipo).filter(Boolean))].sort() };
}

const etiqueta = (it) => {
  const rotulo = `${it.hora ? it.hora + " " : ""}${it.pasta ? it.pasta + " - " : ""}${it.titulo}`;
  if (!it.prazo) return html`<a class="etiqueta ${it.cor}${it.feito ? " feito" : ""}" href="${it.href}" title="${rotulo}">${rotulo}</a>`;
  const fatal = it.prazo_fatal ? it.prazo_fatal.split("-").reverse().join("/") : "";
  const noFatal = it.data === it.prazo_fatal;
  const movel = !it.feito && !!it.prazo_fatal;
  return html`<a class="etiqueta ${it.cor}${it.feito ? " feito" : ""}${noFatal ? " no-fatal" : ""}" href="${it.href}"
    title="${rotulo} · Prazo fatal: ${fatal}${it.feito ? " (cumprido)" : movel ? " · arraste para reprogramar" : ""}"
    ${movel ? seguro(`draggable="true" data-prazo="${it.id}" data-fatal="${it.prazo_fatal}"`) : ""}>${rotulo}</a>`;
};

async function calendarioMensal(req, env, sessao) {
  const sp = new URL(req.url).searchParams;
  const hoje = hojeBR();
  const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") || "") ? sp.get("mes") : hoje.slice(0, 7);
  const primeiro = `${mes}-01`;
  const [ano, m] = mes.split("-").map(Number);
  const ultimo = somarDias(`${m === 12 ? ano + 1 : ano}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
  const dowPrimeiro = new Date(`${primeiro}T12:00:00Z`).getUTCDay();
  const inicioGrade = somarDias(primeiro, -dowPrimeiro);
  const semanas = Math.ceil((dowPrimeiro + Number(ultimo.slice(8))) / 7);
  const fimGrade = somarDias(inicioGrade, semanas * 7 - 1);
  const { porDia, feriados, tipos } = await itensDoPeriodo(env, inicioGrade, fimGrade);
  const mesAnt = (m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, "0")}`);
  const mesSeg = (m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`);

  const celulas = [];
  for (let i = 0; i < semanas * 7; i++) {
    const d = somarDias(inicioGrade, i);
    const dow = i % 7;
    const itens = porDia.get(d) || [];
    const feriado = feriados.get(d);
    const classes = ["dia", d.slice(0, 7) !== mes ? "fora" : "", dow === 0 || dow === 6 || feriado ? "nao-util" : "", d === hoje ? "hoje" : ""].filter(Boolean).join(" ");
    celulas.push(html`<div class="${classes}" data-data="${d}">
      <div class="dia-topo">${feriado ? html`<span class="feriado-nome">${feriado}</span>` : ""}<a class="dia-num" href="/sistema/agenda/dia/${d}">${String(Number(d.slice(8)))}</a></div>
      <div class="dia-itens">${itens.slice(0, MAX_POR_DIA).map(etiqueta)}
        ${itens.length > MAX_POR_DIA ? html`<a class="ver-mais" href="/sistema/agenda/dia/${d}">ver mais ${String(itens.length - MAX_POR_DIA)}...</a>` : ""}</div>
    </div>`);
  }
  return resposta(pagina({
    titulo: "Agenda", sessao,
    corpo: html`
      <div class="titulo-acoes"><h1>Agenda</h1><span><a class="botao-link" href="/sistema/prazos/novo">Novo prazo</a> <a class="botao-link" href="/sistema/agenda/novo">Novo compromisso</a></span></div>
      <nav class="abas"><a href="/sistema/agenda" class="ativa">Calendário</a><a href="/sistema/agenda?visao=lista">Lista de compromissos</a></nav>
      <div class="cal-navegacao">
        <a href="/sistema/agenda?mes=${mesAnt}" aria-label="Mês anterior">‹</a>
        <strong>${MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1)} de ${String(ano)}</strong>
        <a href="/sistema/agenda?mes=${mesSeg}" aria-label="Próximo mês">›</a>
        ${mes !== hoje.slice(0, 7) ? html`<a class="cal-hoje" href="/sistema/agenda">Hoje</a>` : ""}
      </div>
      <p class="dica">Arraste um prazo para reprogramar a data de trabalho (prazo interno). O prazo fatal não muda e a etiqueta não pode ir para depois dele. Etiquetas com borda branca estão no próprio dia do prazo fatal.</p>
      <div class="aviso-flutuante" id="aviso-agenda" role="status" hidden></div>
      <div class="cal-rolagem"><div class="calendario" data-csrf="${sessao.csrf}">
        ${SEMANA.map((s) => html`<div class="cal-semana">${s}</div>`)}
        ${celulas}
      </div></div>
      <div class="legenda">
        <span><i class="cor-compromisso"></i>Compromisso</span>
        ${tipos.map((t) => html`<span><i class="${corDoTipo(t)}"></i>${t}</span>`)}
        <span><i class="feito-amostra"></i>Cumprido</span>
      </div>
      <script src="/assets/js/agenda.js" defer></script>`,
  }));
}

async function agendaDoDia(req, env, sessao, data) {
  const { porDia, feriados } = await itensDoPeriodo(env, data, data);
  const itens = porDia.get(data) || [];
  const [a, m, d] = data.split("-");
  return resposta(pagina({
    titulo: `Agenda ${d}/${m}/${a}`, sessao,
    corpo: html`<p class="trilha"><a href="/sistema/agenda?mes=${a}-${m}">Agenda</a></p>
      <h1>${d}/${m}/${a}${feriados.get(data) ? html` <small class="subtitulo">· ${feriados.get(data)}</small>` : ""}</h1>
      <div class="titulo-acoes"><span></span><span><a class="botao-link" href="/sistema/agenda/novo">Novo compromisso</a></span></div>
      <section class="cartao">${itens.length ? html`<div class="lista-etiquetas">${itens.map(etiqueta)}</div>` : html`<p>Nada marcado para este dia.</p>`}</section>`,
  }));
}

export async function agenda(req, env, sessao, id) {
  const visao = new URL(req.url).searchParams.get("visao");
  if (!id && visao !== "lista" && visao !== "anteriores") return calendarioMensal(req, env, sessao);
  if (id && id.startsWith("dia/")) return agendaDoDia(req, env, sessao, id.slice(4));
  if (!id) {
    const passados = visao === "anteriores";
    const { results } = await env.DB.prepare(`SELECT a.*, pr.pasta, pr.numero FROM agenda a LEFT JOIN processos pr ON pr.id = a.processo_id
      WHERE a.data ${passados ? "<" : ">="} ? ORDER BY a.data ${passados ? "DESC" : "ASC"}, a.hora LIMIT 300`).bind(hojeBR()).all();
    return resposta(pagina({
      titulo: "Agenda", sessao,
      corpo: html`
        <div class="titulo-acoes"><h1>Agenda</h1><a class="botao-link" href="/sistema/agenda/novo">Novo compromisso</a></div>
        <nav class="abas"><a href="/sistema/agenda">Calendário</a><a href="/sistema/agenda?visao=lista" class="${passados ? "" : "ativa"}">Próximos compromissos</a><a href="/sistema/agenda?visao=anteriores" class="${passados ? "ativa" : ""}">Anteriores</a></nav>
        ${results.length ? html`<div class="tabela-rolagem"><table>
          <thead><tr><th>Data</th><th>Compromisso</th><th>Local</th><th>Processo</th><th>Situação</th></tr></thead>
          <tbody>${results.map((a) => html`<tr>
            <td class="nowrap">${dataBR(a.data)} ${a.hora || ""}</td>
            <td><a href="/sistema/agenda/${String(a.id)}">${a.titulo}</a>${a.tipo ? html`<br><small>${a.tipo}</small>` : ""}</td>
            <td>${a.local}</td>
            <td>${a.processo_id ? html`<a href="/sistema/processos/${String(a.processo_id)}">${a.pasta ? `Pasta ${a.pasta}` : a.numero}</a>` : "—"}</td>
            <td>${SITUACOES.find((s) => s[0] === a.situacao)?.[1]}</td></tr>`)}</tbody>
        </table></div>` : html`<section class="cartao"><p>Nenhum compromisso ${passados ? "anterior" : "agendado"}.</p></section>`}`,
    }));
  }

  const novo = id === "novo";
  const ex = novo ? null : await env.DB.prepare("SELECT * FROM agenda WHERE id = ?").bind(Number(id)).first();
  if (!novo && !ex) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Compromisso não encontrado</h1>` }), 404);
  const apoio = await listasApoio(env);
  const tela = (a, erro) => resposta(pagina({
    titulo: novo ? "Novo compromisso" : a.titulo, sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/agenda">Agenda</a></p><h1>${novo ? "Novo compromisso" : a.titulo}</h1>
      <section class="cartao"><form method="post" class="formulario grade-form">${campoCsrf(sessao)}
        <label class="largo">Título<input name="titulo" required maxlength="200" value="${a.titulo || ""}"></label>
        <label>Tipo<input name="tipo" maxlength="100" value="${a.tipo || ""}" list="tipos-agenda"></label>
        <label>Situação<select name="situacao">${opcoes(SITUACOES, a.situacao || "agendado", "Agendado")}</select></label>
        <label>Data<input type="date" name="data" required value="${a.data || ""}"></label>
        <label>Hora<input type="time" name="hora" value="${a.hora || ""}"></label>
        <label class="largo">Local<input name="local" maxlength="300" value="${a.local || ""}" placeholder="Endereço, sala virtual ou fórum"></label>
        <label class="largo">Processo<select name="processo_id">${opcoes(apoio.processos, a.processo_id, "Sem processo vinculado")}</select></label>
        <label class="largo">Observações<textarea name="observacoes" rows="3" maxlength="4000">${a.observacoes || ""}</textarea></label>
        <div class="largo botoes-form"><button type="submit">Salvar</button></div>
        <datalist id="tipos-agenda"><option value="Audiência"><option value="Reunião com cliente"><option value="Perícia"><option value="Diligência"><option value="Sessão de julgamento"></datalist>
      </form></section>`,
  }));
  if (req.method === "GET") return tela(ex || { processo_id: Number(new URL(req.url).searchParams.get("processo")) || null });
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return tela(ex || {}, "Sessão expirada. Tente novamente.");
  const a = {
    titulo: txt(f, "titulo", 200), tipo: txt(f, "tipo", 100), data: dataValida(txt(f, "data")), hora: txt(f, "hora", 10),
    local: txt(f, "local", 300), processo_id: Number(f.get("processo_id")) || null, observacoes: txt(f, "observacoes", 4000),
    situacao: ["agendado", "realizado", "cancelado"].includes(f.get("situacao")) ? f.get("situacao") : "agendado",
  };
  if (!a.titulo || !a.data) return tela(a, "Informe o título e a data.");
  const t = agora();
  let aid = ex?.id;
  if (ex) {
    await env.DB.prepare("UPDATE agenda SET titulo=?, tipo=?, data=?, hora=?, local=?, processo_id=?, observacoes=?, situacao=?, atualizado_em=? WHERE id=?")
      .bind(a.titulo, a.tipo, a.data, a.hora, a.local, a.processo_id, a.observacoes, a.situacao, t, ex.id).run();
  } else {
    const r = await env.DB.prepare("INSERT INTO agenda (titulo, tipo, data, hora, local, processo_id, observacoes, situacao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(a.titulo, a.tipo, a.data, a.hora, a.local, a.processo_id, a.observacoes, a.situacao, sessao.usuario_id, t, t).run();
    aid = r.meta.last_row_id;
  }
  await auditar(env, req, sessao.usuario_id, ex ? "compromisso_alterado" : "compromisso_criado", `agenda ${aid}`);
  return redirecionar("/sistema/agenda");
}
