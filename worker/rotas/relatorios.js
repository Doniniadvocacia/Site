// Relatórios contábeis do Financeiro: livro-caixa, DRE simplificada, fluxo de caixa mensal e contas a receber/pagar.
// Abrem na tela para conferência; "Imprimir / PDF" usa a versão de impressão da página; "Planilha" exporta CSV no padrão do Excel brasileiro.
import { html, pagina, resposta, dataBR, moeda } from "../html.js";
import { hojeBR, somarDias } from "../calendario.js";
import { auditar } from "../sessao.js";
import { dataValida } from "./comum.js";
import { NOME_ESCRITORIO, somarMeses } from "./financeiro.js";

const TIPOS = {
  livro: "Livro-caixa",
  dre: "DRE simplificada",
  fluxo: "Fluxo de caixa mensal",
  abertos: "Contas a receber e a pagar",
};
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const arred = (v) => Math.round((v || 0) * 100) / 100;
const DATA_CAIXA = "COALESCE(f.data_pagamento, f.vencimento)";
const BASE = `FROM financeiro f LEFT JOIN processos pr ON pr.id = f.processo_id LEFT JOIN clientes c ON c.id = COALESCE(f.cliente_id, pr.cliente_id)`;
const parte = (l) => (l.tipo === "receita" ? l.cliente || l.pagante : l.favorecido || l.cliente) || "";

// ---------- Período e filtros ----------
function lerParametros(sp, hoje) {
  const tipo = TIPOS[sp.get("tipo")] ? sp.get("tipo") : "livro";
  let de = dataValida(sp.get("de") || ""), ate = dataValida(sp.get("ate") || "");
  if (!de && !ate) {
    if (tipo === "fluxo") { de = `${hoje.slice(0, 4)}-01-01`; ate = `${hoje.slice(0, 4)}-12-31`; }
    else if (tipo !== "abertos") { de = `${hoje.slice(0, 7)}-01`; ate = somarDias(somarMeses(de, 1), -1); }
  }
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const conta = (sp.get("conta") || "").slice(0, 80);
  const regime = sp.get("regime") === "competencia" ? "competencia" : "caixa";
  const formato = sp.get("formato") === "csv" ? "csv" : "tela";
  return { tipo, de, ate, conta, regime, formato };
}
const textoPeriodo = ({ de, ate }) => (de && ate ? `${dataBR(de)} a ${dataBR(ate)}` : de ? `a partir de ${dataBR(de)}` : ate ? `até ${dataBR(ate)}` : "todo o período");

// ---------- Montagem dos relatórios (dados neutros: usados pela tela e pela planilha) ----------
async function livroCaixa(env, p) {
  const filtroConta = p.conta ? " AND f.conta = ?" : "";
  const extra = p.conta ? [p.conta] : [];
  const ini = await env.DB.prepare(`SELECT SUM(CASE f.tipo WHEN 'receita' THEN f.valor ELSE -f.valor END) AS s ${BASE} WHERE f.pago = 1 AND ${DATA_CAIXA} < ?${filtroConta}`)
    .bind(p.de || "0000-01-01", ...extra).first();
  const { results } = await env.DB.prepare(`SELECT f.id, f.tipo, f.categoria, f.descricao, f.valor, f.conta, f.forma_pagamento, f.pagante, f.favorecido, f.parcela, f.parcelas,
      ${DATA_CAIXA} AS data, c.nome AS cliente, pr.pasta ${BASE}
      WHERE f.pago = 1 AND ${DATA_CAIXA} >= ? AND ${DATA_CAIXA} <= ?${filtroConta} ORDER BY data, f.id`).bind(p.de || "0000-01-01", p.ate || "9999-12-31", ...extra).all();
  let saldo = arred(ini?.s);
  const saldoInicial = saldo;
  const linhas = results.map((l) => {
    saldo = arred(saldo + (l.tipo === "receita" ? l.valor : -l.valor));
    const hist = `${l.descricao}${l.parcelas > 1 ? ` (${l.parcela}/${l.parcelas})` : ""}${l.pasta ? ` · Pasta ${l.pasta}` : ""}`;
    return { data: l.data, historico: hist, categoria: l.categoria || "", parte: parte(l), conta: l.conta || "",
      entrada: l.tipo === "receita" ? l.valor : null, saida: l.tipo === "despesa" ? l.valor : null, saldo };
  });
  const entradas = arred(linhas.reduce((s, l) => s + (l.entrada || 0), 0)), saidas = arred(linhas.reduce((s, l) => s + (l.saida || 0), 0));
  return { saldoInicial, linhas, entradas, saidas, saldoFinal: arred(saldoInicial + entradas - saidas) };
}

async function dre(env, p) {
  const data = p.regime === "caixa" ? DATA_CAIXA : "f.vencimento";
  const pago = p.regime === "caixa" ? "f.pago = 1 AND " : "";
  const filtroConta = p.conta ? " AND f.conta = ?" : "";
  const { results } = await env.DB.prepare(`SELECT f.tipo, COALESCE(NULLIF(TRIM(f.categoria), ''), 'Sem tipo de lançamento') AS categoria, SUM(f.valor) AS total, COUNT(*) AS n
      ${BASE} WHERE ${pago}${data} >= ? AND ${data} <= ?${filtroConta} GROUP BY 1, 2 ORDER BY total DESC`)
    .bind(p.de || "0000-01-01", p.ate || "9999-12-31", ...(p.conta ? [p.conta] : [])).all();
  const receitas = results.filter((r) => r.tipo === "receita").map((r) => ({ ...r, total: arred(r.total) }));
  const despesas = results.filter((r) => r.tipo === "despesa").map((r) => ({ ...r, total: arred(r.total) }));
  const totalR = arred(receitas.reduce((s, r) => s + r.total, 0)), totalD = arred(despesas.reduce((s, r) => s + r.total, 0));
  return { receitas, despesas, totalR, totalD, resultado: arred(totalR - totalD), margem: totalR ? Math.round(((totalR - totalD) / totalR) * 1000) / 10 : null };
}

async function fluxo(env, p) {
  const de = p.de || "2000-01-01", ate = p.ate || hojeBR();
  const filtroConta = p.conta ? " AND f.conta = ?" : "";
  const extra = p.conta ? [p.conta] : [];
  const [ini, real, prev, contas] = await Promise.all([
    env.DB.prepare(`SELECT SUM(CASE f.tipo WHEN 'receita' THEN f.valor ELSE -f.valor END) AS s ${BASE} WHERE f.pago = 1 AND ${DATA_CAIXA} < ?${filtroConta}`).bind(de, ...extra).first(),
    env.DB.prepare(`SELECT substr(${DATA_CAIXA}, 1, 7) AS mes, SUM(CASE WHEN f.tipo = 'receita' THEN f.valor ELSE 0 END) AS e, SUM(CASE WHEN f.tipo = 'despesa' THEN f.valor ELSE 0 END) AS s
      ${BASE} WHERE f.pago = 1 AND ${DATA_CAIXA} >= ? AND ${DATA_CAIXA} <= ?${filtroConta} GROUP BY 1`).bind(de, ate, ...extra).all(),
    env.DB.prepare(`SELECT substr(f.vencimento, 1, 7) AS mes, SUM(CASE WHEN f.tipo = 'receita' THEN f.valor ELSE 0 END) AS e, SUM(CASE WHEN f.tipo = 'despesa' THEN f.valor ELSE 0 END) AS s
      ${BASE} WHERE f.pago = 0 AND f.vencimento >= ? AND f.vencimento <= ?${filtroConta} GROUP BY 1`).bind(de, ate, ...extra).all(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(f.conta), ''), 'Sem conta informada') AS conta, SUM(CASE WHEN f.tipo = 'receita' THEN f.valor ELSE 0 END) AS e,
      SUM(CASE WHEN f.tipo = 'despesa' THEN f.valor ELSE 0 END) AS s ${BASE} WHERE f.pago = 1 AND ${DATA_CAIXA} >= ? AND ${DATA_CAIXA} <= ?${filtroConta} GROUP BY 1 ORDER BY 1`).bind(de, ate, ...extra).all(),
  ]);
  const porMes = (r) => Object.fromEntries(r.results.map((x) => [x.mes, x]));
  const R = porMes(real), P = porMes(prev);
  let saldo = arred(ini?.s);
  const saldoInicial = saldo;
  const meses = [];
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7) && meses.length < 120; m = somarMeses(`${m}-01`, 1).slice(0, 7)) {
    const e = arred(R[m]?.e), s = arred(R[m]?.s);
    saldo = arred(saldo + e - s);
    meses.push({ mes: m, entradas: e, saidas: s, resultado: arred(e - s), saldo, aReceber: arred(P[m]?.e), aPagar: arred(P[m]?.s) });
  }
  const tot = (k) => arred(meses.reduce((t, x) => t + x[k], 0));
  return { saldoInicial, meses, entradas: tot("entradas"), saidas: tot("saidas"), aReceber: tot("aReceber"), aPagar: tot("aPagar"), saldoFinal: saldo,
    contas: contas.results.map((c) => ({ conta: c.conta, entradas: arred(c.e), saidas: arred(c.s), resultado: arred(c.e - c.s) })) };
}

async function abertos(env, p) {
  const hoje = hojeBR();
  const onde = ["f.pago = 0"], args = [];
  if (p.de) { onde.push("f.vencimento >= ?"); args.push(p.de); }
  if (p.ate) { onde.push("f.vencimento <= ?"); args.push(p.ate); }
  if (p.conta) { onde.push("f.conta = ?"); args.push(p.conta); }
  const { results } = await env.DB.prepare(`SELECT f.id, f.tipo, f.categoria, f.descricao, f.valor, f.vencimento, f.pagante, f.favorecido, f.parcela, f.parcelas, f.conta,
      c.nome AS cliente, pr.pasta ${BASE} WHERE ${onde.join(" AND ")} ORDER BY f.vencimento, f.id LIMIT 3000`).bind(...args).all();
  const dia = 86400000;
  const itens = results.map((l) => ({ ...l, parte: parte(l) || "Sem identificação",
    atraso: l.vencimento < hoje ? Math.round((Date.parse(hoje) - Date.parse(l.vencimento)) / dia) : 0 }));
  const lado = (tipo) => {
    const xs = itens.filter((l) => l.tipo === tipo);
    const grupos = new Map();
    for (const l of xs) { if (!grupos.has(l.parte)) grupos.set(l.parte, []); grupos.get(l.parte).push(l); }
    return {
      itens: xs, total: arred(xs.reduce((s, l) => s + l.valor, 0)), vencido: arred(xs.filter((l) => l.atraso).reduce((s, l) => s + l.valor, 0)),
      grupos: [...grupos.entries()].map(([nome, ls]) => ({ nome, itens: ls, total: arred(ls.reduce((s, l) => s + l.valor, 0)) })).sort((a, b) => b.total - a.total),
    };
  };
  return { receber: lado("receita"), pagar: lado("despesa"), hoje };
}

// ---------- Planilha (CSV para Excel em português: ponto e vírgula, vírgula decimal, UTF-8 com BOM) ----------
const num = (v) => (v === null || v === undefined || v === "" ? "" : Number(v).toFixed(2).replace(".", ","));
const celula = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`; // evita fórmulas em planilha
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csv(p, d, emissor) {
  const L = [[NOME_ESCRITORIO], [TIPOS[p.tipo]], [`Período: ${textoPeriodo(p)}${p.conta ? ` · Conta: ${p.conta}` : ""}${p.tipo === "dre" ? ` · Regime de ${p.regime}` : ""}`],
    [`Emitido em ${dataBR(hojeBR())} por ${emissor}`], []];
  if (p.tipo === "livro") {
    L.push(["Data", "Histórico", "Tipo de lançamento", "Cliente / favorecido", "Conta", "Entrada", "Saída", "Saldo"]);
    L.push(["", "Saldo anterior", "", "", "", "", "", num(d.saldoInicial)]);
    for (const l of d.linhas) L.push([dataBR(l.data), l.historico, l.categoria, l.parte, l.conta, num(l.entrada), num(l.saida), num(l.saldo)]);
    L.push(["", "Totais do período", "", "", "", num(d.entradas), num(d.saidas), num(d.saldoFinal)]);
  } else if (p.tipo === "dre") {
    L.push(["Grupo", "Tipo de lançamento", "Lançamentos", "Valor", "% da receita"]);
    const pct = (v) => (d.totalR ? `${(Math.round((v / d.totalR) * 1000) / 10).toFixed(1).replace(".", ",")}%` : "");
    for (const r of d.receitas) L.push(["Receitas", r.categoria, r.n, num(r.total), pct(r.total)]);
    L.push(["Receitas", "Total de receitas", "", num(d.totalR), d.totalR ? "100,0%" : ""]);
    for (const r of d.despesas) L.push(["Despesas", r.categoria, r.n, num(-r.total), pct(r.total)]);
    L.push(["Despesas", "Total de despesas", "", num(-d.totalD), pct(d.totalD)]);
    L.push(["Resultado", "Resultado do período", "", num(d.resultado), d.margem === null ? "" : `${String(d.margem).replace(".", ",")}%`]);
  } else if (p.tipo === "fluxo") {
    L.push(["Mês", "Entradas", "Saídas", "Resultado", "Saldo acumulado", "Previsto a receber", "Previsto a pagar"]);
    L.push(["Saldo anterior", "", "", "", num(d.saldoInicial), "", ""]);
    for (const m of d.meses) L.push([rotMes(m.mes), num(m.entradas), num(m.saidas), num(m.resultado), num(m.saldo), num(m.aReceber), num(m.aPagar)]);
    L.push(["Total", num(d.entradas), num(d.saidas), num(d.entradas - d.saidas), num(d.saldoFinal), num(d.aReceber), num(d.aPagar)]);
    L.push([]); L.push(["Por conta", "Entradas", "Saídas", "Resultado"]);
    for (const c of d.contas) L.push([c.conta, num(c.entradas), num(c.saidas), num(c.resultado)]);
  } else {
    L.push(["Situação", "Cliente / favorecido", "Vencimento", "Descrição", "Tipo de lançamento", "Dias em atraso", "Valor"]);
    for (const [rot, lado] of [["A receber", d.receber], ["A pagar", d.pagar]]) {
      for (const l of lado.itens) L.push([rot, l.parte, dataBR(l.vencimento), `${l.descricao}${l.parcelas > 1 ? ` (${l.parcela}/${l.parcelas})` : ""}`, l.categoria || "", l.atraso || "", num(l.valor)]);
      L.push([`Total ${rot.toLowerCase()}`, "", "", "", "", `vencido: ${num(lado.vencido)}`, num(lado.total)]);
    }
  }
  return "﻿" + L.map((r) => r.map(celula).join(";")).join("\r\n") + "\r\n";
}

// ---------- Tela ----------
const brl = (v) => (v === null || v === undefined ? "" : moeda(v));
const cls = (v) => (v < 0 ? "negativo" : "");

function corpoRelatorio(p, d) {
  if (p.tipo === "livro") return html`
    <table class="tabela-relatorio"><thead><tr><th>Data</th><th>Histórico</th><th>Tipo de lançamento</th><th>Cliente / favorecido</th><th>Conta</th><th class="num">Entrada</th><th class="num">Saída</th><th class="num">Saldo</th></tr></thead>
      <tbody><tr class="linha-saldo"><td></td><td colspan="6">Saldo anterior</td><td class="${`num ${cls(d.saldoInicial)}`}">${brl(d.saldoInicial)}</td></tr>
      ${d.linhas.length ? d.linhas.map((l) => html`<tr><td>${dataBR(l.data)}</td><td>${l.historico}</td><td>${l.categoria}</td><td>${l.parte}</td><td>${l.conta}</td>
        <td class="num entrada">${brl(l.entrada)}</td><td class="num saida">${brl(l.saida)}</td><td class="${`num ${cls(l.saldo)}`}">${brl(l.saldo)}</td></tr>`)
        : html`<tr><td colspan="8" class="vazio">Nenhum pagamento ou recebimento no período.</td></tr>`}</tbody>
      <tfoot><tr><td></td><td colspan="4">Totais do período</td><td class="num entrada">${brl(d.entradas)}</td><td class="num saida">${brl(d.saidas)}</td><td class="${`num ${cls(d.saldoFinal)}`}">${brl(d.saldoFinal)}</td></tr></tfoot>
    </table>`;
  if (p.tipo === "dre") {
    const pct = (v) => (d.totalR ? `${(Math.round((v / d.totalR) * 1000) / 10).toFixed(1).replace(".", ",")}%` : "—");
    const grupo = (titulo, itens, total, sinal) => html`<tr class="grupo-dre"><th colspan="4">${titulo}</th></tr>
      ${itens.length ? itens.map((r) => html`<tr><td class="recuo">${r.categoria}</td><td class="num">${String(r.n)}</td><td class="num">${brl(sinal * r.total)}</td><td class="num">${pct(r.total)}</td></tr>`)
        : html`<tr><td class="recuo vazio" colspan="4">Sem lançamentos.</td></tr>`}
      <tr class="subtotal"><td>Total de ${titulo.toLowerCase()}</td><td></td><td class="num">${brl(sinal * total)}</td><td class="num">${titulo === "Receitas" ? (d.totalR ? "100,0%" : "—") : pct(total)}</td></tr>`;
    return html`<table class="tabela-relatorio tabela-dre"><thead><tr><th>Tipo de lançamento</th><th class="num">Lançamentos</th><th class="num">Valor</th><th class="num">% da receita</th></tr></thead>
      <tbody>${grupo("Receitas", d.receitas, d.totalR, 1)}${grupo("Despesas", d.despesas, d.totalD, -1)}</tbody>
      <tfoot><tr><td>Resultado do período</td><td></td><td class="${`num ${cls(d.resultado)}`}">${brl(d.resultado)}</td><td class="num">${d.margem === null ? "—" : `${String(d.margem).replace(".", ",")}%`}</td></tr></tfoot></table>
      <p class="nota-relatorio">${p.regime === "caixa" ? "Regime de caixa: considera só o que foi efetivamente recebido ou pago, pela data do pagamento." : "Regime de competência: considera todos os lançamentos pela data de vencimento, pagos ou não."}</p>`;
  }
  if (p.tipo === "fluxo") return html`
    <table class="tabela-relatorio"><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th><th class="num">Saldo acumulado</th><th class="num">Previsto a receber</th><th class="num">Previsto a pagar</th></tr></thead>
      <tbody><tr class="linha-saldo"><td colspan="4">Saldo anterior</td><td class="${`num ${cls(d.saldoInicial)}`}">${brl(d.saldoInicial)}</td><td></td><td></td></tr>
      ${d.meses.map((m) => html`<tr><td>${rotMes(m.mes)}</td><td class="num entrada">${brl(m.entradas)}</td><td class="num saida">${brl(m.saidas)}</td>
        <td class="${`num ${cls(m.resultado)}`}">${brl(m.resultado)}</td><td class="${`num ${cls(m.saldo)}`}">${brl(m.saldo)}</td><td class="num previsto">${m.aReceber ? brl(m.aReceber) : "—"}</td><td class="num previsto">${m.aPagar ? brl(m.aPagar) : "—"}</td></tr>`)}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${brl(d.entradas)}</td><td class="num">${brl(d.saidas)}</td><td class="${`num ${cls(d.entradas - d.saidas)}`}">${brl(arred(d.entradas - d.saidas))}</td>
        <td class="${`num ${cls(d.saldoFinal)}`}">${brl(d.saldoFinal)}</td><td class="num">${brl(d.aReceber)}</td><td class="num">${brl(d.aPagar)}</td></tr></tfoot></table>
    <h3 class="subtitulo-relatorio">Movimento por conta</h3>
    <table class="tabela-relatorio"><thead><tr><th>Conta</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th></tr></thead>
      <tbody>${d.contas.length ? d.contas.map((c) => html`<tr><td>${c.conta}</td><td class="num entrada">${brl(c.entradas)}</td><td class="num saida">${brl(c.saidas)}</td><td class="${`num ${cls(c.resultado)}`}">${brl(c.resultado)}</td></tr>`)
        : html`<tr><td colspan="4" class="vazio">Sem movimento no período.</td></tr>`}</tbody></table>
    <p class="nota-relatorio">Entradas e saídas realizadas pela data do pagamento. "Previsto" são lançamentos em aberto pelo vencimento.</p>`;
  const lado = (titulo, x) => html`<h3 class="subtitulo-relatorio">${titulo} <span>${brl(x.total)}${x.vencido ? html` · <em class="negativo">vencido ${brl(x.vencido)}</em>` : ""}</span></h3>
    ${x.grupos.length ? html`<table class="tabela-relatorio"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo de lançamento</th><th class="num">Atraso</th><th class="num">Valor</th></tr></thead>
      ${x.grupos.map((g) => html`<tbody><tr class="grupo-dre"><th colspan="4">${g.nome}</th><th class="num">${brl(g.total)}</th></tr>
        ${g.itens.map((l) => html`<tr class="${l.atraso ? "atrasado" : ""}"><td>${dataBR(l.vencimento)}</td><td>${l.descricao}${l.parcelas > 1 ? ` (${l.parcela}/${l.parcelas})` : ""}${l.pasta ? ` · Pasta ${l.pasta}` : ""}</td>
          <td>${l.categoria || ""}</td><td class="num">${l.atraso ? `${l.atraso} d` : ""}</td><td class="num">${brl(l.valor)}</td></tr>`)}</tbody>`)}</table>`
      : html`<p class="vazio">Nada em aberto.</p>`}`;
  return html`${lado("A receber", d.receber)}${lado("A pagar", d.pagar)}`;
}

function resumo(p, d) {
  const card = (rot, v, extra = "") => html`<div class="cartao-resumo"><span>${rot}</span><strong class="${cls(v)}">${brl(v)}</strong>${extra ? html`<small>${extra}</small>` : ""}</div>`;
  if (p.tipo === "livro") return html`${card("Saldo anterior", d.saldoInicial)}${card("Entradas", d.entradas)}${card("Saídas", d.saidas)}${card("Saldo final", d.saldoFinal)}`;
  if (p.tipo === "dre") return html`${card("Receitas", d.totalR)}${card("Despesas", d.totalD)}${card("Resultado", d.resultado, d.margem === null ? "" : `margem ${String(d.margem).replace(".", ",")}%`)}`;
  if (p.tipo === "fluxo") return html`${card("Saldo anterior", d.saldoInicial)}${card("Entradas", d.entradas)}${card("Saídas", d.saidas)}${card("Saldo final", d.saldoFinal)}`;
  return html`${card("A receber", d.receber.total, `vencido ${moeda(d.receber.vencido)}`)}${card("A pagar", d.pagar.total, `vencido ${moeda(d.pagar.vencido)}`)}${card("Saldo previsto", arred(d.receber.total - d.pagar.total))}`;
}

export async function relatorios(req, env, sessao) {
  const hoje = hojeBR();
  const sp = new URL(req.url).searchParams;
  const p = lerParametros(sp, hoje);
  const d = await { livro: livroCaixa, dre, fluxo, abertos }[p.tipo](env, p);
  const nomeArq = `${TIPOS[p.tipo].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")}${p.de ? `-${p.de}` : ""}${p.ate ? `-a-${p.ate}` : ""}`;
  if (p.formato === "csv") {
    await auditar(env, req, sessao.usuario_id, "relatorio_exportado", `${p.tipo} ${textoPeriodo(p)}`);
    return new Response(csv(p, d, sessao.nome), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nomeArq}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  await auditar(env, req, sessao.usuario_id, "relatorio_visualizado", `${p.tipo} ${textoPeriodo(p)}`);
  const { results: contas } = await env.DB.prepare("SELECT DISTINCT conta FROM financeiro WHERE COALESCE(conta, '') != '' ORDER BY conta").all();
  const q = (o) => { const u = new URLSearchParams({ tipo: p.tipo, de: p.de || "", ate: p.ate || "", conta: p.conta, ...(p.tipo === "dre" ? { regime: p.regime } : {}), ...o }); for (const [k, v] of [...u]) if (!v) u.delete(k); return `/sistema/financeiro/relatorios?${u}`; };
  const atalhos = p.tipo === "fluxo"
    ? [["Este ano", `${hoje.slice(0, 4)}-01-01`, `${hoje.slice(0, 4)}-12-31`], ["Ano passado", `${Number(hoje.slice(0, 4)) - 1}-01-01`, `${Number(hoje.slice(0, 4)) - 1}-12-31`], ["Últimos 12 meses", somarMeses(`${hoje.slice(0, 7)}-01`, -11), somarDias(somarMeses(`${hoje.slice(0, 7)}-01`, 1), -1)]]
    : p.tipo === "abertos" ? [["Tudo em aberto", "", ""], ["Vencidos", "", somarDias(hoje, -1)], ["Próximos 30 dias", hoje, somarDias(hoje, 30)]]
      : [["Este mês", `${hoje.slice(0, 7)}-01`, somarDias(somarMeses(`${hoje.slice(0, 7)}-01`, 1), -1)], ["Mês passado", somarMeses(`${hoje.slice(0, 7)}-01`, -1), somarDias(`${hoje.slice(0, 7)}-01`, -1)],
        ["Este ano", `${hoje.slice(0, 4)}-01-01`, `${hoje.slice(0, 4)}-12-31`], ["Ano passado", `${Number(hoje.slice(0, 4)) - 1}-01-01`, `${Number(hoje.slice(0, 4)) - 1}-12-31`]];
  const op = (lista, atual) => lista.map(([v, r]) => html`<option value="${v}"${String(atual) === String(v) ? html` selected` : ""}>${r}</option>`);
  const emitido = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 16).replace("T", " às ");
  return resposta(pagina({
    titulo: TIPOS[p.tipo], sessao,
    corpo: html`<p class="trilha nao-imprimir"><a href="/sistema/financeiro">Financeiro</a></p>
      <div class="titulo-acoes nao-imprimir"><h1>Relatórios contábeis</h1>
        <span class="botoes-titulo"><button type="button" class="botao-secundario" data-imprimir>Imprimir / salvar PDF</button>
        <a class="botao-link" href="${q({ formato: "csv" })}" download>Exportar planilha</a></span></div>
      <nav class="abas nao-imprimir">${Object.entries(TIPOS).map(([k, v]) => html`<a href="/sistema/financeiro/relatorios?tipo=${k}${p.conta ? `&conta=${encodeURIComponent(p.conta)}` : ""}" class="${k === p.tipo ? "ativa" : ""}">${v}</a>`)}</nav>
      <form method="get" class="filtros-financeiro filtros-relatorio nao-imprimir">
        <input type="hidden" name="tipo" value="${p.tipo}">
        <label>${p.tipo === "abertos" ? "Vencimento a partir de" : "Data inicial"}<input type="date" name="de" value="${p.de || ""}"></label>
        <label>${p.tipo === "abertos" ? "Vencimento até" : "Data final"}<input type="date" name="ate" value="${p.ate || ""}"></label>
        <label>Conta<select name="conta">${op([["", "Todas as contas"], ...contas.map((c) => [c.conta, c.conta])], p.conta)}</select></label>
        ${p.tipo === "dre" ? html`<label>Regime<select name="regime">${op([["caixa", "Caixa (pagos)"], ["competencia", "Competência (vencimento)"]], p.regime)}</select></label>` : ""}
        <div class="botoes-filtro"><button type="submit">Gerar</button></div>
        <p class="atalhos-periodo">${atalhos.map(([r, de, ate]) => html`<a href="${q({ de, ate })}">${r}</a>`)}</p>
      </form>
      <article class="relatorio">
        <header class="cabecalho-relatorio">
          <div><p class="marca-relatorio">${NOME_ESCRITORIO}</p><h2>${TIPOS[p.tipo]}</h2></div>
          <dl><div><dt>Período</dt><dd>${textoPeriodo(p)}</dd></div>${p.conta ? html`<div><dt>Conta</dt><dd>${p.conta}</dd></div>` : ""}
            ${p.tipo === "dre" ? html`<div><dt>Regime</dt><dd>${p.regime === "caixa" ? "Caixa" : "Competência"}</dd></div>` : ""}
            <div><dt>Emitido</dt><dd>${emitido.split(" às ")[0].split("-").reverse().join("/")} às ${emitido.split(" às ")[1]} · ${sessao.nome}</dd></div></dl>
        </header>
        <div class="resumo-financeiro resumo-relatorio">${resumo(p, d)}</div>
        ${corpoRelatorio(p, d)}
        <footer class="rodape-relatorio">Relatório gerado pelo Diligo · ${NOME_ESCRITORIO}. Valores em reais (R$).</footer>
      </article>
      <script src="/assets/js/relatorio.js" defer></script>`,
  }));
}
