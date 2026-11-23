// Financeiro: receitas e despesas, parcelas, recorrências e baixas.
// Acesso: administradores e usuários com a credencial do financeiro (sessao.financeiro).
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, moeda } from "../html.js";
import { agora, cifrar, decifrar, tokenAleatorio } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { salvarAnexo, excluirAnexo, anexosDisponiveis } from "../anexos.js";
import { opcoes, listasApoio, csrfOk, txt, dataValida, numeroBR, rotuloProcesso, bloco } from "./comum.js";
import { linkAnexo } from "./historico.js";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CATEGORIAS = {
  receita: ["Honorários Contratuais", "Honorários Sucumbenciais", "Pró-Labore", "Alvará Judicial", "Pagamento Acordo", "Pagamento Condenação", "Reembolso de Custas", "Outras Receitas"],
  despesa: ["Custas Processuais", "Sistemas e Softwares", "Anuidade OAB", "Aluguel", "Impostos", "Salários", "Pró-Labore", "Repasse a Cliente", "Outras Despesas"],
};
const FORMAS = ["Pix", "Transferência", "Crédito em Conta", "Boleto", "Cartão de Crédito", "Dinheiro", "Alvará"].map((x) => [x, x]);
const CONDICOES = [["À Vista", "À vista"], ["Parcelado", "Parcelado"], ["Entrada+Parcelado", "Entrada + parcelado"], ["Recorrente", "Recorrente (mensal)"]];

const negado = (sessao) => resposta(pagina({ titulo: "Acesso restrito", sessao, corpo: html`<h1>Acesso restrito</h1><p>O financeiro é liberado para administradores e usuários com credencial específica.</p>` }), 403);

// Soma meses mantendo o dia (31/01 + 1 mês → 28/02 ou 29/02).
export function somarMeses(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

// Divide um total em n parcelas; os centavos que sobram vão para a última.
export function dividir(total, n) {
  const base = Math.floor((total / n) * 100) / 100;
  const v = Array(n).fill(base);
  v[n - 1] = Math.round((total - base * (n - 1)) * 100) / 100;
  return v;
}

// Gera os lançamentos de uma condição de pagamento.
export function gerarParcelas({ condicao, valor, entrada, parcelas, vencimento }) {
  if (condicao === "Parcelado") return dividir(valor, parcelas).map((v, i) => ({ valor: v, vencimento: somarMeses(vencimento, i), parcela: i + 1, parcelas }));
  if (condicao === "Entrada+Parcelado") {
    return [{ valor: entrada, vencimento, parcela: 0, parcelas },
      ...dividir(Math.round((valor - entrada) * 100) / 100, parcelas).map((v, i) => ({ valor: v, vencimento: somarMeses(vencimento, i + 1), parcela: i + 1, parcelas }))];
  }
  if (condicao === "Recorrente") return Array.from({ length: parcelas }, (_, i) => ({ valor, vencimento: somarMeses(vencimento, i), parcela: i + 1, parcelas }));
  return [{ valor, vencimento, parcela: null, parcelas: null }];
}

const rotuloParcela = (l) => (l.parcela === 0 ? "Entrada" : l.parcela ? `${l.parcela}/${l.parcelas}` : "");
function situacao(l, hoje = hojeBR()) {
  if (l.pago) return html`<span class="selo selo-pago">${l.tipo === "receita" ? "Recebido" : "Pago"}</span> <small>${dataBR(l.data_pagamento)}</small>`;
  if (l.vencimento < hoje) return html`<span class="selo selo-vencido">Em atraso</span>`;
  if (l.vencimento === hoje) return html`<span class="selo selo-hoje">Vence hoje</span>`;
  return html`<span class="selo selo-semana">Em aberto</span>`;
}

function tabela(sessao, linhas, { mostrarProcesso = true } = {}) {
  if (!linhas.length) return html`<p class="vazio">Nenhum lançamento.</p>`;
  return html`<div class="tabela-rolagem"><table class="tabela-financeiro">
    <thead><tr><th>Vencimento</th><th>Descrição</th>${mostrarProcesso ? html`<th>Cliente / processo</th>` : ""}<th class="num">Valor</th><th>Situação</th><th></th></tr></thead>
    <tbody>${linhas.map((l) => html`<tr>
      <td class="nowrap">${dataBR(l.vencimento)}</td>
      <td><a href="/sistema/financeiro/${String(l.id)}">${l.descricao}</a>${rotuloParcela(l) ? html` <small class="parcela">${rotuloParcela(l)}</small>` : ""}
        <br><small>${l.categoria || ""}</small>${l.anexo_id ? linkAnexo(l) : ""}</td>
      ${mostrarProcesso ? html`<td>${l.cliente_nome || ""}${l.processo_id ? html`<br><small><a href="/sistema/processos/${String(l.processo_id)}">${rotuloProcesso(l)}</a></small>` : ""}</td>` : ""}
      <td class="num nowrap ${l.tipo}">${l.tipo === "despesa" ? "− " : ""}${moeda(l.valor)}</td>
      <td class="nowrap">${situacao(l)}</td>
      <td>${l.pago ? "" : html`<form method="post" action="/sistema/financeiro/${String(l.id)}/baixar" class="form-linha">${campoCsrf(sessao)}<button class="botao-pequeno" type="submit">${l.tipo === "receita" ? "Recebido" : "Pago"}</button></form>`}</td>
    </tr>`)}</tbody></table></div>`;
}

const SELECT_LANC = `SELECT f.*, COALESCE(c.nome, c2.nome) AS cliente_nome, pr.pasta, pr.numero, a.nome AS anexo_nome, (a.chave IS NULL) AS anexo_pendente
  FROM financeiro f LEFT JOIN processos pr ON pr.id = f.processo_id LEFT JOIN clientes c ON c.id = f.cliente_id
  LEFT JOIN clientes c2 ON c2.id = pr.cliente_id LEFT JOIN anexos a ON a.id = f.anexo_id`;

// Cartão para as fichas de processo e de cliente.
export async function cartaoFinanceiro(env, sessao, { processoId = null, clienteId = null }) {
  if (!sessao.financeiro) return "";
  const onde = processoId ? "f.processo_id = ?" : "(f.cliente_id = ? OR pr.cliente_id = ?)";
  const args = processoId ? [processoId] : [clienteId, clienteId];
  const { results } = await env.DB.prepare(`${SELECT_LANC} WHERE ${onde} ORDER BY f.vencimento DESC LIMIT 200`).bind(...args).all();
  const soma = (fn) => results.filter(fn).reduce((s, l) => s + l.valor, 0);
  const recebido = soma((l) => l.tipo === "receita" && l.pago), aReceber = soma((l) => l.tipo === "receita" && !l.pago), despesas = soma((l) => l.tipo === "despesa");
  const novo = processoId ? `/sistema/financeiro/novo?processo=${processoId}` : `/sistema/financeiro/novo?cliente=${clienteId}`;
  return bloco("Lançamentos Financeiros", html`
    ${results.length ? html`<p class="resumo-linha">Recebido <strong class="receita">${moeda(recebido)}</strong> · A receber <strong>${moeda(aReceber)}</strong> · Despesas <strong class="despesa">${moeda(despesas)}</strong></p>` : ""}
    ${tabela(sessao, results, { mostrarProcesso: !processoId })}`,
    { id: "financeiro", contagem: results.length, acoes: html`<a class="botao-link botao-pequeno" href="${novo}">Novo lançamento</a>` });
}

// ---------- Formulário ----------
function formulario(sessao, l, apoio, acao, { novo, grupoQtd = 0, anexos = false }) {
  const cats = [...new Set([...CATEGORIAS.receita, ...CATEGORIAS.despesa, ...apoio.categorias])];
  return html`<form method="post" action="${acao}" enctype="multipart/form-data" class="formulario grade-form">
    ${campoCsrf(sessao)}
    <fieldset class="largo tipo-lanc"><legend>Tipo</legend>
      <label class="opcao"><input type="radio" name="tipo" value="receita"${l.tipo !== "despesa" ? html` checked` : ""}> Receita</label>
      <label class="opcao"><input type="radio" name="tipo" value="despesa"${l.tipo === "despesa" ? html` checked` : ""}> Despesa</label>
    </fieldset>
    <label class="largo">Descrição<input name="descricao" required maxlength="300" value="${l.descricao || ""}" placeholder="Ex.: Honorários iniciais — ação regressiva"></label>
    <label>Categoria<input name="categoria" maxlength="80" value="${l.categoria || ""}" list="l-categorias"></label>
    <label>Processo<select name="processo_id">${opcoes(apoio.processos, l.processo_id, "Sem processo")}</select></label>
    <label>Cliente<select name="cliente_id">${opcoes(apoio.clientes, l.cliente_id, "Do processo / nenhum")}</select></label>
    <label>Responsável<select name="responsavel">${opcoes(apoio.responsaveis, l.responsavel)}</select></label>
    ${novo ? html`<fieldset class="largo grade-form"><legend>Valor e condição</legend>
      <label>Condição<select name="condicao">${opcoes(CONDICOES, l.condicao || "À Vista", "À vista")}</select></label>
      <label>Valor (R$)<input name="valor" required inputmode="decimal" value="${l.valor_txt ?? ""}" placeholder="0,00"></label>
      <label>Vencimento (1º)<input type="date" name="vencimento" required value="${l.vencimento || ""}"></label>
      <label>Nº de parcelas / meses<input type="number" name="parcelas" min="1" max="120" value="${String(l.parcelas || "")}" placeholder="—"></label>
      <label>Entrada (R$)<input name="entrada" inputmode="decimal" value="${l.entrada_txt ?? ""}" placeholder="só para entrada + parcelado"></label>
      <p class="dica largo">Parcelado: o valor total é dividido em parcelas mensais. Entrada + parcelado: a entrada vence na data informada e o restante é dividido a partir do mês seguinte. Recorrente: o valor se repete todo mês pelo número de meses informado.</p>
    </fieldset>` : html`
      <label>Valor (R$)<input name="valor" required inputmode="decimal" value="${l.valor_txt ?? ""}"></label>
      <label>Vencimento<input type="date" name="vencimento" required value="${l.vencimento || ""}"></label>
      ${l.grupo ? html`<p class="dica largo">${rotuloParcela(l) ? `Parcela ${rotuloParcela(l)} · ` : ""}${l.condicao || ""}. A alteração vale só para este lançamento.</p>` : ""}`}
    <label>Forma de pagamento<select name="forma_pagamento">${opcoes(FORMAS, l.forma_pagamento)}</select></label>
    <label class="opcao-linha"><input type="checkbox" name="pago" value="1"${l.pago ? html` checked` : ""}> Já ${l.tipo === "despesa" ? "pago" : "recebido"}${novo ? " (1ª parcela)" : ""}</label>
    <label>Data do pagamento<input type="date" name="data_pagamento" value="${l.data_pagamento || ""}"></label>
    <label>Pagante<input name="pagante" maxlength="200" value="${l.pagante || ""}"></label>
    <label>Favorecido<input name="favorecido" maxlength="200" value="${l.favorecido || ""}"></label>
    <label class="largo">Dados bancários / Pix<textarea name="dados_bancarios" rows="2" maxlength="1000" placeholder="Banco, agência, conta ou chave Pix">${l.dados_bancarios || ""}</textarea></label>
    <label class="largo">Observações<textarea name="observacoes" rows="2" maxlength="4000">${l.observacoes || ""}</textarea></label>
    ${anexos ? html`<label class="largo">${l.anexo_id ? "Substituir anexo" : "Anexo (comprovante, nota, contrato)"}<input type="file" name="arquivo"></label>
      ${l.anexo_id ? html`<p class="largo">Anexo atual:${linkAnexo(l)} <label class="opcao-linha"><input type="checkbox" name="remover_anexo" value="1"> remover</label></p>` : ""}` : ""}
    <div class="largo botoes-form"><button type="submit" name="acao" value="salvar">Salvar</button></div>
    <datalist id="l-categorias">${cats.map((c) => html`<option value="${c}">`)}</datalist>
  </form>
  ${novo ? "" : html`<form method="post" action="${acao}" class="formulario form-excluir-lanc">${campoCsrf(sessao)}
    <label class="opcao-linha"><input type="checkbox" name="confirmar" value="1" required> Confirmo a exclusão</label>
    ${grupoQtd > 1 ? html`<label class="opcao-linha"><input type="checkbox" name="grupo" value="1"> Excluir também as outras ${String(grupoQtd - 1)} parcela(s) em aberto deste lançamento</label>` : ""}
    <button type="submit" name="acao" value="excluir" class="botao-secundario">Excluir lançamento</button></form>`}
  <p class="dica">Dados bancários e observações são gravados cifrados.</p>`;
}

function lerForm(f) {
  return {
    tipo: f.get("tipo") === "despesa" ? "despesa" : "receita",
    descricao: txt(f, "descricao", 300), categoria: txt(f, "categoria", 80),
    processo_id: Number(f.get("processo_id")) || null, cliente_id: Number(f.get("cliente_id")) || null,
    responsavel: txt(f, "responsavel", 120), condicao: CONDICOES.some(([v]) => v === f.get("condicao")) ? f.get("condicao") : "À Vista",
    valor_txt: txt(f, "valor", 30), entrada_txt: txt(f, "entrada", 30), valor: numeroBR(f.get("valor")), entrada: numeroBR(f.get("entrada")),
    parcelas: Math.max(0, Math.min(120, Number(f.get("parcelas")) || 0)), vencimento: dataValida(txt(f, "vencimento")),
    forma_pagamento: txt(f, "forma_pagamento", 40), pago: f.get("pago") === "1" ? 1 : 0, data_pagamento: dataValida(txt(f, "data_pagamento")),
    pagante: txt(f, "pagante", 200), favorecido: txt(f, "favorecido", 200), dados_bancarios: txt(f, "dados_bancarios", 1000), observacoes: txt(f, "observacoes", 4000),
  };
}

function validar(l, novo) {
  if (!l.descricao) return "Informe a descrição.";
  if (!l.vencimento) return "Informe o vencimento.";
  if (l.valor === null || Number.isNaN(l.valor) || l.valor <= 0) return "Informe um valor válido (ex.: 1.500,00).";
  if (!novo) return null;
  if (l.condicao !== "À Vista" && l.parcelas < 1) return "Informe o número de parcelas ou de meses.";
  if (l.condicao === "Parcelado" && l.parcelas < 2) return "Parcelado precisa de pelo menos 2 parcelas.";
  if (l.condicao === "Entrada+Parcelado") {
    if (l.entrada === null || Number.isNaN(l.entrada) || l.entrada <= 0) return "Informe o valor da entrada.";
    if (l.entrada >= l.valor) return "A entrada precisa ser menor que o valor total.";
  }
  return null;
}

async function apoioForm(env) {
  const [base, clientes, cats] = await Promise.all([
    listasApoio(env),
    env.DB.prepare("SELECT id, nome FROM clientes ORDER BY nome COLLATE NOCASE").all(),
    env.DB.prepare("SELECT DISTINCT categoria FROM financeiro WHERE COALESCE(categoria, '') != '' ORDER BY 1").all(),
  ]);
  return { ...base, clientes: clientes.results.map((c) => [c.id, c.nome]), categorias: cats.results.map((c) => c.categoria) };
}

// ---------- Rotas ----------
export async function financeiro(req, env, sessao, id) {
  if (!sessao.financeiro) return negado(sessao);
  const hoje = hojeBR();

  // Baixa rápida
  if (id && id.endsWith("/baixar") && req.method === "POST") {
    const { ok } = await csrfOk(req, sessao);
    const lid = Number(id.split("/")[0]);
    if (ok) {
      await env.DB.prepare("UPDATE financeiro SET pago = 1, data_pagamento = ?, atualizado_em = ? WHERE id = ? AND pago = 0").bind(hoje, agora(), lid).run();
      await auditar(env, req, sessao.usuario_id, "financeiro_baixa", `lançamento ${lid}`);
    }
    const ref = req.headers.get("Referer");
    return redirecionar(ref && new URL(ref).pathname.startsWith("/sistema/") ? new URL(ref).pathname + new URL(ref).search : "/sistema/financeiro");
  }

  // Lista mensal
  if (!id) {
    const sp = new URL(req.url).searchParams;
    const mes = /^\d{4}-\d{2}$/.test(sp.get("mes") || "") ? sp.get("mes") : hoje.slice(0, 7);
    const tipo = ["receita", "despesa"].includes(sp.get("tipo")) ? sp.get("tipo") : "";
    const sit = ["aberto", "pago", "atrasado"].includes(sp.get("situacao")) ? sp.get("situacao") : "";
    const ini = `${mes}-01`, fim = somarMeses(ini, 1);
    const [{ results: doMes }, atraso] = await Promise.all([
      env.DB.prepare(`${SELECT_LANC} WHERE f.vencimento >= ? AND f.vencimento < ? ORDER BY f.vencimento, f.id`).bind(ini, fim).all(),
      env.DB.prepare(`SELECT SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS receber, SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS pagar,
        COUNT(*) AS n FROM financeiro WHERE pago = 0 AND vencimento < ?`).bind(hoje).first(),
    ]);
    const soma = (fn) => doMes.filter(fn).reduce((s, l) => s + l.valor, 0);
    const rec = soma((l) => l.tipo === "receita"), recPago = soma((l) => l.tipo === "receita" && l.pago);
    const desp = soma((l) => l.tipo === "despesa"), despPago = soma((l) => l.tipo === "despesa" && l.pago);
    const linhas = doMes.filter((l) => (!tipo || l.tipo === tipo) && (!sit || (sit === "pago" ? l.pago : sit === "aberto" ? !l.pago : !l.pago && l.vencimento < hoje)));
    const [a, m] = mes.split("-").map(Number);
    const url = (o) => { const q = new URLSearchParams({ mes, ...(tipo && { tipo }), ...(sit && { situacao: sit }), ...o }); for (const [k, v] of [...q]) if (!v) q.delete(k); return `/sistema/financeiro?${q}`; };
    const aba = (chave, valor, rotulo, atual) => html`<a href="${url({ [chave]: valor })}" class="${atual === valor ? "ativa" : ""}">${rotulo}</a>`;
    return resposta(pagina({
      titulo: "Financeiro", sessao,
      corpo: html`
        <div class="titulo-acoes"><h1>Financeiro</h1><a class="botao-link" href="/sistema/financeiro/novo">Novo lançamento</a></div>
        <div class="navegacao-mes">
          <a href="${url({ mes: somarMeses(ini, -1).slice(0, 7) })}" aria-label="Mês anterior">‹</a>
          <strong>${MESES[m - 1]} de ${String(a)}</strong>
          <a href="${url({ mes: somarMeses(ini, 1).slice(0, 7) })}" aria-label="Próximo mês">›</a>
          ${mes !== hoje.slice(0, 7) ? html`<a class="hoje" href="${url({ mes: hoje.slice(0, 7) })}">Mês atual</a>` : ""}
        </div>
        <div class="resumo-financeiro">
          <div class="cartao-resumo receita"><span>Receitas do mês</span><strong>${moeda(rec)}</strong><small>Recebido ${moeda(recPago)}</small></div>
          <div class="cartao-resumo despesa"><span>Despesas do mês</span><strong>${moeda(desp)}</strong><small>Pago ${moeda(despPago)}</small></div>
          <div class="cartao-resumo"><span>Saldo realizado</span><strong class="${recPago - despPago < 0 ? "despesa" : "receita"}">${moeda(recPago - despPago)}</strong><small>Previsto ${moeda(rec - desp)}</small></div>
          <div class="cartao-resumo alerta"><span>Em atraso (todos os meses)</span><strong>${moeda(atraso?.receber || 0)}</strong><small>a receber · ${moeda(atraso?.pagar || 0)} a pagar</small></div>
        </div>
        <nav class="abas">${aba("tipo", "", "Tudo", tipo)}${aba("tipo", "receita", "Receitas", tipo)}${aba("tipo", "despesa", "Despesas", tipo)}
          <span class="separador"></span>${aba("situacao", "", "Todas", sit)}${aba("situacao", "aberto", "Em aberto", sit)}${aba("situacao", "atrasado", "Em atraso", sit)}${aba("situacao", "pago", "Pagas", sit)}</nav>
        ${tabela(sessao, linhas)}
        <p class="dica">${String(linhas.length)} lançamento(s).</p>`,
    }));
  }

  // Novo / editar / excluir
  const novo = id === "novo";
  const existente = novo ? null : await env.DB.prepare(`${SELECT_LANC} WHERE f.id = ?`).bind(Number(id)).first();
  if (!novo && !existente) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Lançamento não encontrado</h1>` }), 404);
  const apoio = await apoioForm(env);
  const acao = novo ? "/sistema/financeiro/novo" : `/sistema/financeiro/${existente.id}`;
  const grupoQtd = existente?.grupo ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM financeiro WHERE grupo = ? AND (pago = 0 OR id = ?)").bind(existente.grupo, existente.id).first()).n : 0;
  const tela = (l, { erro, aviso } = {}) => resposta(pagina({
    titulo: novo ? "Novo lançamento" : existente.descricao, sessao, erro, aviso,
    corpo: html`<p class="trilha"><a href="/sistema/financeiro${l.vencimento ? `?mes=${l.vencimento.slice(0, 7)}` : ""}">Financeiro</a></p>
      <h1>${novo ? "Novo lançamento" : existente.descricao}</h1>
      <section class="cartao">${formulario(sessao, l, apoio, acao, { novo, grupoQtd, anexos: anexosDisponiveis(env) })}</section>`,
  }));

  if (req.method === "GET") {
    if (novo) {
      const sp = new URL(req.url).searchParams;
      const pid = Number(sp.get("processo")) || null;
      const proc = pid ? await env.DB.prepare("SELECT cliente_id FROM processos WHERE id = ?").bind(pid).first() : null;
      return tela({ tipo: sp.get("tipo") === "despesa" ? "despesa" : "receita", processo_id: pid, cliente_id: Number(sp.get("cliente")) || proc?.cliente_id || null, vencimento: hoje, responsavel: sessao.nome });
    }
    const [dados_bancarios, observacoes] = await Promise.all([decifrar(env, existente.dados_bancarios_enc), decifrar(env, existente.observacoes_enc)]);
    return tela({ ...existente, dados_bancarios, observacoes, valor_txt: existente.valor.toFixed(2).replace(".", ",") }, new URL(req.url).searchParams.get("salvo") ? { aviso: "Lançamento salvo." } : {});
  }

  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return tela(existente || {}, { erro: "Sessão expirada. Tente novamente." });

  if (!novo && f.get("acao") === "excluir") {
    if (f.get("confirmar") !== "1") return tela({ ...existente, valor_txt: existente.valor.toFixed(2).replace(".", ",") }, { erro: "Marque a confirmação para excluir." });
    const alvo = f.get("grupo") === "1" && existente.grupo
      ? (await env.DB.prepare("SELECT id, anexo_id FROM financeiro WHERE grupo = ? AND (pago = 0 OR id = ?)").bind(existente.grupo, existente.id).all()).results
      : [{ id: existente.id, anexo_id: existente.anexo_id }];
    for (const x of alvo) {
      await env.DB.prepare("DELETE FROM financeiro WHERE id = ?").bind(x.id).run();
      const usado = x.anexo_id ? await env.DB.prepare("SELECT 1 FROM financeiro WHERE anexo_id = ? LIMIT 1").bind(x.anexo_id).first() : true;
      if (!usado) await excluirAnexo(env, x.anexo_id);
    }
    await auditar(env, req, sessao.usuario_id, "financeiro_excluido", `lançamento(s) ${alvo.map((x) => x.id).join(", ")}`);
    return redirecionar(`/sistema/financeiro?mes=${existente.vencimento.slice(0, 7)}`);
  }

  const l = lerForm(f);
  const erro = validar(l, novo);
  if (erro) return tela({ ...(existente || {}), ...l }, { erro });
  if (l.pago && !l.data_pagamento) l.data_pagamento = hoje;
  if (!l.pago) l.data_pagamento = null;
  if (!l.cliente_id && l.processo_id) l.cliente_id = (await env.DB.prepare("SELECT cliente_id FROM processos WHERE id = ?").bind(l.processo_id).first())?.cliente_id ?? null;

  let anexoId = existente?.anexo_id ?? null;
  try {
    const enviado = await salvarAnexo(env, f.get("arquivo"), "financeiro", sessao.usuario_id);
    if (enviado || f.get("remover_anexo") === "1") {
      const antigo = anexoId;
      anexoId = enviado;
      if (antigo && existente) {
        await env.DB.prepare("UPDATE financeiro SET anexo_id = NULL WHERE id = ?").bind(existente.id).run();
        const usado = await env.DB.prepare("SELECT 1 FROM financeiro WHERE anexo_id = ? LIMIT 1").bind(antigo).first();
        if (!usado) await excluirAnexo(env, antigo);
      }
    }
  } catch (e) { return tela({ ...(existente || {}), ...l }, { erro: e.message }); }

  const [bancEnc, obsEnc] = await Promise.all([cifrar(env, l.dados_bancarios), cifrar(env, l.observacoes)]);
  const t = agora();
  const comuns = [l.tipo, l.categoria, l.descricao, l.processo_id, l.cliente_id, l.forma_pagamento, l.responsavel, l.pagante, l.favorecido, bancEnc, obsEnc, anexoId];

  if (!novo) {
    await env.DB.prepare(`UPDATE financeiro SET tipo=?1, categoria=?2, descricao=?3, processo_id=?4, cliente_id=?5, forma_pagamento=?6, responsavel=?7,
      pagante=?8, favorecido=?9, dados_bancarios_enc=?10, observacoes_enc=?11, anexo_id=?12, valor=?13, vencimento=?14, pago=?15, data_pagamento=?16,
      atualizado_em=?17 WHERE id=?18`).bind(...comuns, l.valor, l.vencimento, l.pago, l.data_pagamento, t, existente.id).run();
    await auditar(env, req, sessao.usuario_id, "financeiro_alterado", `lançamento ${existente.id}`);
    return redirecionar(`/sistema/financeiro/${existente.id}?salvo=1`);
  }

  const parcelas = gerarParcelas(l);
  const grupo = parcelas.length > 1 ? `g_${tokenAleatorio(9)}` : null;
  const stmts = parcelas.map((p, i) => env.DB.prepare(`INSERT INTO financeiro (tipo, categoria, descricao, processo_id, cliente_id, forma_pagamento, responsavel,
      pagante, favorecido, dados_bancarios_enc, observacoes_enc, anexo_id, valor, vencimento, pago, data_pagamento, condicao, grupo, parcela, parcelas,
      criado_por, criado_em, atualizado_em) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?22)`)
    .bind(...comuns, p.valor, p.vencimento, i === 0 ? l.pago : 0, i === 0 ? l.data_pagamento : null, l.condicao, grupo, p.parcela, p.parcelas, sessao.usuario_id, t));
  const res = await env.DB.batch(stmts);
  await auditar(env, req, sessao.usuario_id, "financeiro_criado", `${parcelas.length} lançamento(s)${grupo ? ` grupo ${grupo}` : ""}`);
  return parcelas.length > 1
    ? redirecionar(`/sistema/financeiro?mes=${l.vencimento.slice(0, 7)}`)
    : redirecionar(`/sistema/financeiro/${res[0].meta.last_row_id}?salvo=1`);
}
