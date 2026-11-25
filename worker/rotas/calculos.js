// Cálculos judiciais: atualização monetária e juros com índices do Banco Central, relatório para imprimir/PDF e planilha.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, moeda } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { csrfOk } from "./comum.js";
import { celula, num as numCsv } from "./relatorios.js";
import { NOME_ESCRITORIO, campoBusca } from "./financeiro.js";
import { calcular, lerParametros, validar, REGIMES, CORRECOES, JUROS, LEI_14905 } from "../calculos-motor.js";
import { SERIES, carregarIndices, atualizarIndices, situacaoIndices } from "../indices.js";

const brl = (v) => moeda(v);
const pct = (v, c = 4) => `${(Math.round(v * 10 ** c) / 10 ** c).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: c })}%`;
const fator = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const MSG = { salvo: "Cálculo salvo.", indices: "Índices atualizados com o Banco Central.", excluido: "Cálculo excluído." };

async function processos(env) {
  const { results } = await env.DB.prepare(`SELECT p.id, p.pasta, p.numero, c.nome AS cliente FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id
    ORDER BY CAST(p.pasta AS INTEGER), p.pasta`).all();
  return results.map((p) => [p.id, [p.pasta && `Pasta ${p.pasta}`, p.numero, p.cliente].filter(Boolean).join(" · ")]);
}

// Na primeira utilização a tabela de índices está vazia: carrega o histórico antes de calcular.
async function garantirIndices(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM indices").first();
  if (!r?.n) await atualizarIndices(env);
}

const textoRegime = (p) => {
  const r = REGIMES[p.regime] || REGIMES.civel;
  if (p.regime === "personalizado") return `Personalizado: ${CORRECOES[p.correcao]} + ${JUROS[p.juros]}${p.aplicar_lei ? "; desde 30/08/2024, IPCA + taxa legal (Lei 14.905/2024)" : ""}`;
  return r.nome.replace(/correção \+/, `${CORRECOES[p.indice_anterior]} +`).replace(/^Cível — correção até/, `Cível — ${CORRECOES[p.indice_anterior]} até`);
};
const textoJuros = (p) => (p.regime === "trabalhista" ? `Ajuizamento em ${dataBR(p.marco)}`
  : p.juros_desde === "marco" ? `Juros desde ${dataBR(p.marco)} (${(REGIMES[p.regime] || REGIMES.civel).marco.split(" (")[0].toLowerCase()})` : "Juros desde o vencimento de cada parcela");

// ---------- Formulário ----------
function linhaParcela(x = {}) {
  return html`<tr class="linha-parcela">
    <td><input type="date" name="parcela_data" value="${x.data || ""}" aria-label="Data"></td>
    <td><input name="parcela_descricao" value="${x.descricao || ""}" maxlength="120" placeholder="Ex.: Dano material" aria-label="Descrição"></td>
    <td><input name="parcela_valor" value="${x.valor !== undefined && x.valor !== "" ? String(x.valor).replace(".", ",") : ""}" inputmode="decimal" placeholder="0,00" aria-label="Valor" class="campo-valor"></td>
    <td><button type="button" class="botao-icone" data-remover-linha title="Remover parcela" aria-label="Remover parcela">×</button></td></tr>`;
}
function linhaExtra(x = {}) {
  return html`<tr class="linha-extra">
    <td><input name="extra_descricao" value="${x.descricao || ""}" maxlength="120" placeholder="Ex.: Custas processuais" aria-label="Descrição"></td>
    <td><input name="extra_valor" value="${x.valor !== undefined && x.valor !== "" ? String(x.valor).replace(".", ",") : ""}" inputmode="decimal" placeholder="0,00" aria-label="Valor" class="campo-valor"></td>
    <td><button type="button" class="botao-icone" data-remover-linha title="Remover" aria-label="Remover">×</button></td></tr>`;
}

function formulario(sessao, p, procs, acao) {
  const op = (obj, sel) => Object.entries(obj).map(([v, r]) => html`<option value="${v}"${v === sel ? html` selected` : ""}>${r}</option>`);
  const parcelas = p.parcelas?.length ? p.parcelas : [{}];
  return html`<form method="post" action="${acao}" class="form-calculo" id="form-calculo">${campoCsrf(sessao)}
    <section class="cartao">
      <h2>Identificação</h2>
      <div class="grade-calculo">
        <label class="duplo">Título<input name="titulo" value="${p.titulo || ""}" maxlength="150" placeholder="Ex.: Atualização da condenação — sentença de 10/03/2025"></label>
        ${campoBusca({ tipo: "processo", rotulo: "Processo", nome: "processo_id", id: p.processo_id, texto: p.processo_id ? (procs.find(([v]) => Number(v) === Number(p.processo_id)) || [])[1] : "", placeholder: "Buscar por parte, nº do processo ou pasta" })}
      </div>
    </section>
    <section class="cartao">
      <h2>Critérios</h2>
      <div class="grade-calculo">
        <label class="largo">Regime de atualização<select name="regime" data-regime>${op(Object.fromEntries(Object.entries(REGIMES).map(([k, r]) => [k, r.nome])), p.regime || "civel")}</select></label>
        <label data-so="civel civel_selic">Índice até 29/08/2024<select name="indice_anterior">${op({ ipca: "IPCA", ipcae: "IPCA-E", inpc: "INPC", igpm: "IGP-M" }, p.indice_anterior || "igpm")}</select></label>
        <label data-so="personalizado">Correção monetária<select name="correcao">${op(CORRECOES, p.correcao || "ipca")}</select></label>
        <label data-so="personalizado">Juros de mora<select name="juros">${op(JUROS, p.juros || "1am")}</select></label>
        <label data-so="personalizado">A partir de 30/08/2024<select name="aplicar_lei">${op({ sim: "Aplicar Lei 14.905 (IPCA + taxa legal)", nao: "Manter os critérios acima" }, p.aplicar_lei === false ? "nao" : "sim")}</select></label>
        <label data-nao="trabalhista">Juros desde<select name="juros_desde" data-juros-desde>${op({ evento: "O vencimento de cada parcela (evento danoso)", marco: "Uma data fixa (citação)" }, p.juros_desde || "evento")}</select></label>
        <label data-marco><span data-rotulo-marco>${(REGIMES[p.regime] || REGIMES.civel).marco}</span><input type="date" name="marco" value="${p.marco || ""}"></label>
        <label>Data do cálculo<input type="date" name="data_final" value="${p.data_final || hojeBR()}" required></label>
      </div>
      <p class="dica" data-explica-regime></p>
    </section>
    <section class="cartao">
      <div class="titulo-acoes"><h2>Parcelas</h2><span class="botoes-titulo"><button type="button" class="botao-secundario botao-mini" data-gerar-mensais>Gerar parcelas mensais</button>
        <button type="button" class="botao-secundario botao-mini" data-adicionar="parcela">Adicionar parcela</button></span></div>
      <div class="gerador-mensal" hidden data-gerador>
        <label>Primeiro vencimento<input type="date" data-g-inicio></label>
        <label>Quantidade de meses<input type="number" min="1" max="300" value="12" data-g-qtd></label>
        <label>Valor mensal<input inputmode="decimal" placeholder="0,00" data-g-valor></label>
        <label>Descrição<input placeholder="Ex.: Aluguel" data-g-desc></label>
        <button type="button" class="botao-mini" data-g-ok>Incluir</button>
      </div>
      <div class="tabela-rolagem"><table class="tabela-parcelas">
        <thead><tr><th>Data (vencimento)</th><th>Descrição</th><th>Valor original (R$)</th><th></th></tr></thead>
        <tbody data-lista="parcela">${parcelas.map((x) => linhaParcela(x))}</tbody>
      </table></div>
      <template data-modelo="parcela">${linhaParcela()}</template>
      <p class="dica">Valores negativos lançam pagamentos parciais (abatidos já atualizados, pelos mesmos critérios).</p>
    </section>
    <section class="cartao">
      <h2>Acréscimos</h2>
      <div class="grade-calculo">
        <label>Multa (%) <small>ex.: art. 523 do CPC</small><input name="multa" value="${p.multa ? String(p.multa).replace(".", ",") : ""}" inputmode="decimal" placeholder="0"></label>
        <label>Honorários (%)<input name="honorarios" value="${p.honorarios ? String(p.honorarios).replace(".", ",") : ""}" inputmode="decimal" placeholder="0"></label>
        <label class="duplo">Base dos honorários<select name="honorarios_base">${op({ com_multa: "Valor atualizado + multa", sem_multa: "Valor atualizado (sem a multa)" }, p.honorarios_base || "com_multa")}</select></label>
      </div>
      <h3 class="subtitulo-calculo">Outros valores <small>(somados sem atualização, ex.: custas já atualizadas)</small> <button type="button" class="botao-secundario botao-mini" data-adicionar="extra">Adicionar</button></h3>
      <table class="tabela-parcelas tabela-extras"><tbody data-lista="extra">${(p.extras || []).map((x) => linhaExtra(x))}</tbody></table>
      <template data-modelo="extra">${linhaExtra()}</template>
      <label class="campo-obs">Observações (saem no relatório)<textarea name="observacoes" rows="3" maxlength="2000">${p.observacoes || ""}</textarea></label>
    </section>
    <div class="botoes-form">
      <button type="submit" name="acao" value="calcular" class="botao-secundario" formaction="${acao}#resultado">Calcular (prévia)</button>
      <button type="submit" name="acao" value="salvar">Salvar cálculo</button>
    </div>
    <script src="/assets/js/selecao.js" defer></script><script src="/assets/js/calculos.js" defer></script>
  </form>`;
}

// ---------- Resultado / relatório ----------
function blocoResultado(p, r, { titulo, processo, completo = true } = {}) {
  const t = r.totais;
  return html`<article class="relatorio relatorio-calculo">
    <header class="cabecalho-relatorio">
      <div><p class="marca-relatorio">${NOME_ESCRITORIO}</p><h2>${titulo || p.titulo || "Cálculo judicial"}</h2>${processo ? html`<p class="dica">${processo}</p>` : ""}</div>
      <dl><div><dt>Data do cálculo</dt><dd>${dataBR(p.data_final)}</dd></div>
        <div><dt>Critério</dt><dd>${textoRegime(p)}</dd></div>
        <div><dt>Juros</dt><dd>${textoJuros(p)}</dd></div></dl>
    </header>
    <div class="resumo-financeiro resumo-relatorio">
      <div class="cartao-resumo"><span>Valor original</span><strong>${brl(t.principal)}</strong></div>
      <div class="cartao-resumo"><span>Correção monetária</span><strong>${brl(t.correcao)}</strong></div>
      <div class="cartao-resumo"><span>Juros de mora</span><strong>${brl(t.juros)}</strong></div>
      <div class="cartao-resumo destaque-total"><span>Total devido</span><strong>${brl(t.total)}</strong></div>
    </div>
    <table class="tabela-relatorio">
      <thead><tr><th>Vencimento</th><th>Descrição</th><th class="num">Valor original</th><th class="num">Fator de correção</th><th class="num">Valor corrigido</th><th class="num">Juros</th><th class="num">Juros (R$)</th><th class="num">Total</th></tr></thead>
      <tbody>${r.linhas.map((l) => html`<tr><td>${dataBR(l.data)}</td><td>${l.descricao || ""}</td><td class="num">${brl(l.valor)}</td><td class="num">${fator(l.fator)}</td>
        <td class="num">${brl(l.corrigido)}</td><td class="num">${pct(l.jurosPct)}</td><td class="num">${brl(l.juros)}</td><td class="num">${brl(l.total)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">Subtotal</td><td class="num">${brl(t.principal)}</td><td></td><td class="num">${brl(t.corrigido)}</td><td></td><td class="num">${brl(t.juros)}</td><td class="num">${brl(t.subtotal)}</td></tr></tfoot>
    </table>
    <table class="tabela-relatorio tabela-totais">
      <tbody>
        <tr><td>Subtotal atualizado (valor corrigido + juros)</td><td class="num">${brl(t.subtotal)}</td></tr>
        ${p.multa ? html`<tr><td>Multa de ${pct(p.multa, 2)}</td><td class="num">${brl(t.multa)}</td></tr>` : ""}
        ${p.honorarios ? html`<tr><td>Honorários de ${pct(p.honorarios, 2)} sobre ${p.honorarios_base === "sem_multa" ? "o valor atualizado" : "o valor atualizado + multa"}</td><td class="num">${brl(t.honorarios)}</td></tr>` : ""}
        ${(p.extras || []).map((e) => html`<tr><td>${e.descricao}</td><td class="num">${brl(e.valor)}</td></tr>`)}
      </tbody>
      <tfoot><tr><td>Total devido em ${dataBR(p.data_final)}</td><td class="num">${brl(t.total)}</td></tr></tfoot>
    </table>
    ${r.avisos.length ? html`<ul class="avisos-calculo">${r.avisos.map((a) => html`<li>${a}</li>`)}</ul>` : ""}
    ${completo ? html`<h3 class="subtitulo-relatorio">Memória do cálculo</h3>
    ${r.linhas.map((l) => html`<div class="memoria-parcela"><p><strong>${dataBR(l.data)}${l.descricao ? ` · ${l.descricao}` : ""}</strong> — ${brl(l.valor)}</p>
      ${l.memoria.length ? html`<table class="tabela-relatorio tabela-memoria"><thead><tr><th>Período</th><th>Correção</th><th class="num">Fator</th><th>Juros</th><th class="num">Juros no período</th></tr></thead>
        <tbody>${l.memoria.map((m) => html`<tr><td>${m.periodo}</td><td>${m.correcao}</td><td class="num">${fator(m.fator)}</td><td>${m.juros}</td><td class="num">${pct(m.jurosPct)}</td></tr>`)}</tbody></table>` : html`<p class="dica">Vencimento na data do cálculo: sem atualização.</p>`}
    </div>`)}` : ""}
    ${p.observacoes ? html`<h3 class="subtitulo-relatorio">Observações</h3><p class="pre">${p.observacoes}</p>` : ""}
    <p class="nota-relatorio">Metodologia: correção pelas variações mensais do índice, do mês do vencimento (inclusive) ao mês do cálculo (exclusive), de forma acumulada;
      juros simples sobre o valor corrigido, pro rata die (taxas mensais proporcionais aos dias de cada mês; taxas fixas por dias corridos/30).
      No período da SELIC não há correção à parte. Desde ${dataBR(LEI_14905)}, art. 389, parágrafo único, e art. 406 do Código Civil (Lei 14.905/2024; taxa legal pela Res. CMN 5.171/2024).
      Índices: Banco Central do Brasil (SGS) — ${Object.values(SERIES).map((s) => `${s.nome}: série ${s.codigo}`).join("; ")}.</p>
    <footer class="rodape-relatorio">Cálculo gerado pelo Diligo · ${NOME_ESCRITORIO}. Confira os critérios com o título executivo.</footer>
  </article>`;
}

function csv(p, r, titulo, emissor) {
  const n = (v) => numCsv(v);
  const L = [[NOME_ESCRITORIO], [titulo || p.titulo || "Cálculo judicial"], [`Data do cálculo: ${dataBR(p.data_final)}`], [`Critério: ${textoRegime(p)}`], [textoJuros(p)],
    [`Emitido em ${dataBR(hojeBR())} por ${emissor}`], [],
    ["Vencimento", "Descrição", "Valor original", "Fator de correção", "Valor corrigido", "Juros (%)", "Juros (R$)", "Total"]];
  for (const l of r.linhas) L.push([dataBR(l.data), l.descricao || "", n(l.valor), l.fator.toFixed(6).replace(".", ","), n(l.corrigido), l.jurosPct.toFixed(4).replace(".", ","), n(l.juros), n(l.total)]);
  const t = r.totais;
  L.push(["Subtotal", "", n(t.principal), "", n(t.corrigido), "", n(t.juros), n(t.subtotal)], []);
  if (p.multa) L.push([`Multa (${String(p.multa).replace(".", ",")}%)`, "", "", "", "", "", "", n(t.multa)]);
  if (p.honorarios) L.push([`Honorários (${String(p.honorarios).replace(".", ",")}%)`, "", "", "", "", "", "", n(t.honorarios)]);
  for (const e of p.extras || []) L.push([e.descricao, "", "", "", "", "", "", n(e.valor)]);
  L.push(["Total devido", "", "", "", "", "", "", n(t.total)], [], ["Memória do cálculo"], ["Vencimento", "Período", "Correção", "Fator", "Juros", "Juros no período (%)"]);
  for (const l of r.linhas) for (const m of l.memoria) L.push([dataBR(l.data), m.periodo, m.correcao, m.fator.toFixed(6).replace(".", ","), m.juros, m.jurosPct.toFixed(4).replace(".", ",")]);
  return "﻿" + L.map((x) => x.map(celula).join(";")).join("\r\n") + "\r\n";
}

// ---------- Rotas ----------
export async function calculos(req, env, sessao, id, acao) {
  const url = new URL(req.url);
  if (id === "indices") return paginaIndices(req, env, sessao);
  if (!id) return lista(req, env, sessao, url);
  const novo = id === "novo";
  const salvo = novo ? null : await env.DB.prepare(`SELECT ca.*, u.nome AS autor FROM calculos ca LEFT JOIN usuarios u ON u.id = ca.criado_por WHERE ca.id = ?`).bind(Number(id)).first();
  if (!novo && !salvo) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Cálculo não encontrado</h1>` }), 404);

  if (acao === "excluir") {
    if (req.method !== "POST" || sessao.perfil !== "admin") return redirecionar(`/sistema/calculos/${id}`);
    const { ok } = await csrfOk(req, sessao);
    if (!ok) return redirecionar(`/sistema/calculos/${id}`);
    await env.DB.prepare("DELETE FROM calculos WHERE id = ?").bind(salvo.id).run();
    await auditar(env, req, sessao.usuario_id, "calculo_excluido", `cálculo ${salvo.id}`);
    return redirecionar("/sistema/calculos?msg=excluido");
  }

  const procs = await processos(env);
  const nomeProc = (pid) => procs.find(([v]) => v === pid)?.[1] || "";

  // Visualização do cálculo salvo (recalcula com os índices atuais).
  if (!novo && acao !== "editar" && req.method === "GET") {
    await garantirIndices(env);
    const p = JSON.parse(salvo.parametros);
    const r = calcular(p, await carregarIndices(env));
    if (url.searchParams.get("formato") === "csv") {
      await auditar(env, req, sessao.usuario_id, "calculo_exportado", `cálculo ${salvo.id}`);
      return new Response(csv(p, r, salvo.titulo, sessao.nome), { headers: { "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="calculo-${salvo.id}-${p.data_final}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const mudou = Math.abs((salvo.total || 0) - r.totais.total) >= 0.01;
    return resposta(pagina({
      titulo: salvo.titulo, sessao, ...(MSG[url.searchParams.get("msg")] ? { aviso: MSG[url.searchParams.get("msg")] } : {}),
      corpo: html`<p class="trilha nao-imprimir"><a href="/sistema/calculos">Cálculos</a>${salvo.processo_id ? html` · <a href="/sistema/processos/${String(salvo.processo_id)}">Processo</a>` : ""}</p>
        <div class="titulo-acoes nao-imprimir"><h1>${salvo.titulo}</h1>
          <span class="botoes-titulo"><a class="botao-link botao-secundario" href="/sistema/calculos/${String(salvo.id)}/editar">Editar</a>
          <a class="botao-link botao-secundario" href="/sistema/calculos/novo?copiar=${String(salvo.id)}">Duplicar</a>
          <button type="button" class="botao-secundario" data-imprimir>Imprimir / salvar PDF</button>
          <a class="botao-link" href="/sistema/calculos/${String(salvo.id)}?formato=csv" download>Exportar planilha</a></span></div>
        ${mudou ? html`<p class="aviso nao-imprimir">O total mudou desde que o cálculo foi salvo (${brl(salvo.total)} → ${brl(r.totais.total)}), porque o Banco Central divulgou ou revisou índices. Salve novamente pela edição para registrar o novo valor.</p>` : ""}
        <p class="dica nao-imprimir">Salvo por ${salvo.autor || "—"} em ${dataBR(new Date((salvo.atualizado_em - 3 * 3600) * 1000).toISOString().slice(0, 10))}.</p>
        ${blocoResultado(p, r, { titulo: salvo.titulo, processo: nomeProc(salvo.processo_id) })}
        ${sessao.perfil === "admin" ? html`<form method="post" action="/sistema/calculos/${String(salvo.id)}/excluir" class="form-excluir-andamento nao-imprimir" data-confirmar="Excluir este cálculo? Esta ação não pode ser desfeita.">${campoCsrf(sessao)}
          <button type="submit" class="botao-perigo">Excluir cálculo</button></form>` : ""}
        <script src="/assets/js/relatorio.js" defer></script><script src="/assets/js/confirmar.js" defer></script>`,
    }));
  }

  // Formulário (novo ou edição)
  const acaoForm = novo ? "/sistema/calculos/novo" : `/sistema/calculos/${salvo.id}/editar`;
  const tela = (p, { erro, resultado } = {}) => resposta(pagina({
    titulo: novo ? "Novo cálculo" : `Editar · ${salvo.titulo}`, sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/calculos">Cálculos</a></p>
      <div class="titulo-acoes"><h1>${novo ? "Novo cálculo judicial" : "Editar cálculo"}</h1><a class="link-discreto" href="/sistema/calculos/indices">Índices</a></div>
      ${formulario(sessao, p, procs, acaoForm)}
      ${resultado ? html`<section class="previa-calculo" id="resultado"><h2>Prévia do resultado</h2>${blocoResultado(p, resultado, { processo: nomeProc(p.processo_id) })}</section>` : ""}`,
  }));

  if (req.method === "GET") {
    if (!novo) return tela({ ...JSON.parse(salvo.parametros), titulo: salvo.titulo, processo_id: salvo.processo_id });
    const copiar = Number(url.searchParams.get("copiar"));
    if (copiar) {
      const c = await env.DB.prepare("SELECT titulo, processo_id, parametros FROM calculos WHERE id = ?").bind(copiar).first();
      if (c) return tela({ ...JSON.parse(c.parametros), titulo: `${c.titulo} (cópia)`, processo_id: c.processo_id, data_final: hojeBR() });
    }
    return tela({ processo_id: Number(url.searchParams.get("processo")) || null });
  }
  const { f, ok } = await csrfOk(req, sessao);
  const p = lerParametros(f);
  if (!ok) return tela(p, { erro: "Sessão expirada. Tente novamente." });
  const erro = validar(p);
  if (erro) return tela(p, { erro });
  await garantirIndices(env);
  const r = calcular(p, await carregarIndices(env));
  if (f.get("acao") !== "salvar") return tela(p, { resultado: r });
  const titulo = p.titulo || `Cálculo de ${dataBR(p.data_final)}`;
  const { titulo: _t, processo_id: pid, ...param } = p;
  const t = agora();
  let cid = salvo?.id;
  if (novo) {
    const ins = await env.DB.prepare("INSERT INTO calculos (processo_id, titulo, parametros, data_final, total, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(pid, titulo, JSON.stringify(param), p.data_final, r.totais.total, sessao.usuario_id, t, t).run();
    cid = ins.meta.last_row_id;
  } else {
    await env.DB.prepare("UPDATE calculos SET processo_id = ?, titulo = ?, parametros = ?, data_final = ?, total = ?, atualizado_em = ? WHERE id = ?")
      .bind(pid, titulo, JSON.stringify(param), p.data_final, r.totais.total, t, cid).run();
  }
  await auditar(env, req, sessao.usuario_id, novo ? "calculo_criado" : "calculo_editado", `cálculo ${cid}`);
  return redirecionar(`/sistema/calculos/${cid}?msg=salvo`);
}

async function lista(req, env, sessao, url) {
  const proc = Number(url.searchParams.get("processo")) || null;
  const { results } = await env.DB.prepare(`SELECT ca.id, ca.titulo, ca.data_final, ca.total, ca.atualizado_em, ca.processo_id, p.pasta, p.numero, u.nome AS autor
      FROM calculos ca LEFT JOIN processos p ON p.id = ca.processo_id LEFT JOIN usuarios u ON u.id = ca.criado_por
      ${proc ? "WHERE ca.processo_id = ?" : ""} ORDER BY ca.atualizado_em DESC LIMIT 300`).bind(...(proc ? [proc] : [])).all();
  const sit = await situacaoIndices(env);
  return resposta(pagina({
    titulo: "Cálculos", sessao, ...(MSG[url.searchParams.get("msg")] ? { aviso: MSG[url.searchParams.get("msg")] } : {}),
    corpo: html`<div class="titulo-acoes"><h1>Cálculos judiciais</h1>
        <span class="botoes-titulo"><a class="botao-link botao-secundario" href="/sistema/calculos/indices">Índices</a><a class="botao-link" href="/sistema/calculos/novo${proc ? `?processo=${proc}` : ""}">Novo cálculo</a></span></div>
      <p class="dica">Atualização monetária e juros com índices oficiais do Banco Central (IPCA, IPCA-E, INPC, IGP-M, SELIC, taxa legal e TR), atualizados automaticamente.
        ${sit.series.ipca ? html`Último IPCA disponível: ${sit.series.ipca.ultimo.slice(5)}/${sit.series.ipca.ultimo.slice(0, 4)}.` : html`Os índices serão carregados no primeiro cálculo.`}</p>
      ${results.length ? html`<div class="tabela-rolagem"><table>
        <thead><tr><th>Cálculo</th><th>Processo</th><th>Data do cálculo</th><th class="num">Total</th><th>Atualizado</th></tr></thead>
        <tbody>${results.map((c) => html`<tr><td><a href="/sistema/calculos/${String(c.id)}">${c.titulo}</a></td>
          <td>${c.processo_id ? html`<a href="/sistema/processos/${String(c.processo_id)}">${c.pasta ? `Pasta ${c.pasta}` : c.numero || "processo"}</a>` : "—"}</td>
          <td>${dataBR(c.data_final)}</td><td class="num">${brl(c.total)}</td><td>${dataBR(new Date((c.atualizado_em - 3 * 3600) * 1000).toISOString().slice(0, 10))} · ${c.autor || ""}</td></tr>`)}</tbody>
      </table></div>` : html`<section class="cartao vazio-pesquisa"><p>Nenhum cálculo salvo${proc ? " para este processo" : ""}. <a href="/sistema/calculos/novo${proc ? `?processo=${proc}` : ""}">Fazer um cálculo</a>.</p></section>`}`,
  }));
}

async function paginaIndices(req, env, sessao) {
  if (req.method === "POST") {
    const { ok } = await csrfOk(req, sessao);
    if (ok) {
      const r = await atualizarIndices(env);
      await auditar(env, req, sessao.usuario_id, "indices_atualizados", r.map((x) => `${x.serie}:${x.erro ? "erro" : x.meses}`).join(" "));
    }
    return redirecionar("/sistema/calculos/indices?msg=indices");
  }
  const sit = await situacaoIndices(env);
  const idx = await carregarIndices(env);
  const meses = [...new Set(Object.values(idx).flatMap((m) => [...m.keys()]))].sort().reverse().slice(0, 13);
  const url = new URL(req.url);
  const quando = sit.ultima ? new Date((sit.ultima.criado_em - 3 * 3600) * 1000).toISOString() : null;
  return resposta(pagina({
    titulo: "Índices", sessao, ...(MSG[url.searchParams.get("msg")] ? { aviso: MSG[url.searchParams.get("msg")] } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/calculos">Cálculos</a></p>
      <div class="titulo-acoes"><h1>Índices econômicos</h1>
        <form method="post">${campoCsrf(sessao)}<button type="submit" class="botao-secundario">Atualizar agora</button></form></div>
      <p class="dica">Fonte: Banco Central do Brasil (SGS). Atualização automática diária; histórico desde ${"01/2000"}.
        ${quando ? html`Última atualização: ${quando.slice(0, 10).split("-").reverse().join("/")} às ${quando.slice(11, 16)}.` : "Ainda não atualizado."}
        ${sit.ultima?.erro ? html`<span class="alerta-texto"> Falha na última atualização: ${sit.ultima.erro}</span>` : ""}</p>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Índice</th><th>Série SGS</th><th>Desde</th><th>Último mês</th><th class="num">Meses</th></tr></thead>
        <tbody>${Object.entries(SERIES).map(([k, s]) => { const x = sit.series[k]; return html`<tr><td>${s.nome}</td><td>${String(s.codigo)}</td>
          <td>${x ? `${x.primeiro.slice(5)}/${x.primeiro.slice(0, 4)}` : "—"}</td><td>${x ? `${x.ultimo.slice(5)}/${x.ultimo.slice(0, 4)}` : "—"}</td><td class="num">${x ? String(x.n) : "0"}</td></tr>`; })}</tbody>
      </table></div>
      ${meses.length ? html`<h2>Últimos meses (% ao mês)</h2><div class="tabela-rolagem"><table class="tabela-indices">
        <thead><tr><th>Mês</th>${Object.values(SERIES).map((s) => html`<th class="num">${s.nome.split(" (")[0]}</th>`)}</tr></thead>
        <tbody>${meses.map((m) => html`<tr><td>${m.slice(5)}/${m.slice(0, 4)}</td>${Object.keys(SERIES).map((k) => { const v = idx[k].get(m); return html`<td class="num">${v === undefined ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>`; })}</tr>`)}</tbody>
      </table></div>` : ""}`,
  }));
}
