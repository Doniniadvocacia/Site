// Motor dos cálculos judiciais (funções puras, sem banco): atualização monetária e juros de mora por período.
//
// Convenções (aparecem na memória do cálculo):
// - Correção monetária: aplica as variações mensais do índice do mês do vencimento (inclusive) ao mês do cálculo (exclusive),
//   compostas (fator acumulado). Mês sem índice divulgado conta como 0% e gera aviso.
// - Juros: simples (não capitalizados), sobre o valor corrigido, pro rata die. Taxas mensais (SELIC, taxa legal, TR) são
//   proporcionais aos dias de cada mês; taxas fixas (1% ou 0,5% ao mês) usam dias corridos / 30.
// - A SELIC já engloba correção e juros: no período em que ela incide não há correção à parte.
// - Lei 14.905/2024: a partir de 30/08/2024, correção pelo IPCA e juros pela taxa legal (SELIC − IPCA, mínimo zero).

export const LEI_14905 = "2024-08-30";
const DIA = 86400000;

export const CORRECOES = { ipca: "IPCA", ipcae: "IPCA-E", inpc: "INPC", igpm: "IGP-M", nenhuma: "Sem correção" };
export const JUROS = { "1am": "1% ao mês", "05am": "0,5% ao mês", selic: "SELIC", taxa_legal: "Taxa legal", tr: "TR (art. 39 da Lei 8.177/91)", nenhum: "Sem juros" };

// Regimes prontos. Cada regime define, para antes/depois do marco (citação ou ajuizamento) e antes/depois da Lei 14.905,
// qual correção (c) e quais juros (j) incidem. "X" = índice escolhido pelo usuário para o período anterior à lei.
export const REGIMES = {
  civel: {
    nome: "Cível — correção + juros de 1% a.m. até 29/08/2024; IPCA + taxa legal depois (Lei 14.905/2024)",
    marco: "Citação (início dos juros)",
    antes: { pre: { c: "X", j: "nenhum" }, pos: { c: "ipca", j: "nenhum" } },
    desde: { pre: { c: "X", j: "1am" }, pos: { c: "ipca", j: "taxa_legal" } },
  },
  civel_selic: {
    nome: "Cível — correção até a citação e SELIC depois (STJ); IPCA + taxa legal desde 30/08/2024",
    marco: "Citação (início da SELIC)",
    antes: { pre: { c: "X", j: "nenhum" }, pos: { c: "ipca", j: "nenhum" } },
    desde: { pre: { c: "nenhuma", j: "selic" }, pos: { c: "ipca", j: "taxa_legal" } },
  },
  trabalhista: {
    nome: "Trabalhista — ADC 58 (IPCA-E + TR antes da ação; SELIC depois) e, desde 30/08/2024, IPCA + taxa legal (TST, E-ED-RR-713-03.2010.5.04.0029)",
    marco: "Ajuizamento da ação",
    antes: { pre: { c: "ipcae", j: "tr" }, pos: { c: "ipca", j: "taxa_legal" } },
    desde: { pre: { c: "nenhuma", j: "selic" }, pos: { c: "ipca", j: "taxa_legal" } },
  },
  personalizado: {
    nome: "Personalizado — índice e juros escolhidos para todo o período",
    marco: "Início dos juros",
  },
};

export const mesDe = (d) => d.slice(0, 7);
const somarMes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const diasEntre = (a, b) => Math.round((ms(b) - ms(a)) / DIA);
const fimDoMes = (mes) => { const p = `${somarMes(mes, 1)}-01`; return p; }; // primeiro dia do mês seguinte (exclusivo)
const diasNoMes = (mes) => diasEntre(`${mes}-01`, fimDoMes(mes));
const arred = (v, c = 2) => Math.round(v * 10 ** c) / 10 ** c;

// Resolve o regime em uma função (data do trecho, antes do marco?) → { c, j }.
export function regras(p) {
  const X = p.indice_anterior in CORRECOES ? p.indice_anterior : "ipca";
  const r = REGIMES[p.regime] || REGIMES.civel;
  if (p.regime === "personalizado") {
    const c = p.correcao in CORRECOES ? p.correcao : "ipca";
    const j = p.juros in JUROS ? p.juros : "1am";
    const aplicaLei = p.aplicar_lei !== false;
    return (data, antesMarco) => {
      if (aplicaLei && data >= LEI_14905) return { c: "ipca", j: antesMarco ? "nenhum" : "taxa_legal" };
      return { c, j: antesMarco ? "nenhum" : j };
    };
  }
  return (data, antesMarco) => {
    const cel = r[antesMarco ? "antes" : "desde"][data >= LEI_14905 ? "pos" : "pre"];
    return { c: cel.c === "X" ? X : cel.c, j: cel.j };
  };
}

// Corta [a, b) nos marcos (início dos juros e Lei 14.905).
function trechos(a, b, marco) {
  const cortes = [marco, LEI_14905].filter((d) => d && d > a && d < b).sort();
  const pts = [a, ...cortes, b];
  return pts.slice(0, -1).map((x, i) => [x, pts[i + 1]]);
}

function fatorCorrecao(serie, mesIni, mesFim, idx, avisos) {
  // meses [mesIni, mesFim)
  let f = 1;
  if (!serie || serie === "nenhuma") return 1;
  for (let m = mesIni; m < mesFim; m = somarMes(m, 1)) {
    const v = idx[serie]?.get(m);
    if (v === undefined) { avisos.add(`${CORRECOES[serie]} de ${m.slice(5)}/${m.slice(0, 4)} ainda não divulgado: considerado 0%.`); continue; }
    f *= 1 + v / 100;
  }
  return f;
}

function percentualJuros(tipo, a, b, idx, avisos) {
  // juros simples no intervalo de dias [a, b)
  if (!tipo || tipo === "nenhum" || a >= b) return 0;
  if (tipo === "1am") return diasEntre(a, b) / 30;
  if (tipo === "05am") return (diasEntre(a, b) / 30) * 0.5;
  let soma = 0;
  for (let m = mesDe(a); m <= mesDe(b); m = somarMes(m, 1)) {
    const ini = `${m}-01` > a ? `${m}-01` : a, fim = fimDoMes(m) < b ? fimDoMes(m) : b;
    if (ini >= fim) continue;
    let v = idx[tipo]?.get(m);
    if (v === undefined) {
      // mês ainda sem taxa divulgada: usa a última conhecida (estimativa)
      let k = somarMes(m, -1), tent = 0;
      while (v === undefined && tent++ < 6) { v = idx[tipo]?.get(k); k = somarMes(k, -1); }
      avisos.add(`${JUROS[tipo]} de ${m.slice(5)}/${m.slice(0, 4)} ainda não divulgada: usada a última taxa conhecida.`);
      if (v === undefined) continue;
    }
    soma += v * (diasEntre(ini, fim) / diasNoMes(m));
  }
  return soma;
}

const br = (d) => d.split("-").reverse().join("/");
const diaAnterior = (d) => new Date(ms(d) - DIA).toISOString().slice(0, 10);
// O fim do trecho é exclusivo; na tela mostra o último dia do trecho (ou a data do cálculo, no último).
const rotuloPeriodo = (a, b, final) => `${br(a)} a ${br(b === final ? b : diaAnterior(b))}`;

// Calcula uma parcela até a data final.
function calcularParcela(par, p, idx, regra, avisos) {
  const d0 = par.data, dF = p.data_final;
  if (d0 >= dF) return { ...par, fator: 1, corrigido: par.valor, jurosPct: 0, juros: 0, total: par.valor, memoria: [] };
  // No trabalhista o marco (ajuizamento) separa as fases mesmo com juros desde o vencimento.
  const marco = p.regime === "trabalhista" ? (p.marco || d0) : p.juros_desde === "evento" ? d0 : (p.marco || d0);
  let fator = 1, jurosPct = 0;
  const memoria = [];
  for (const [a, b] of trechos(d0, dF, marco)) {
    const { c, j } = regra(a, a < marco);
    // correção: meses do trecho [mês(a), mês(b)); o último trecho vai até o mês do cálculo (exclusive)
    const f = fatorCorrecao(c, mesDe(a), mesDe(b), idx, avisos);
    const jp = percentualJuros(j, a, b, idx, avisos);
    fator *= f; jurosPct += jp;
    memoria.push({ periodo: rotuloPeriodo(a, b, dF), correcao: CORRECOES[c] || "—", fator: f, juros: JUROS[j] || "—", jurosPct: jp });
  }
  const corrigido = arred(par.valor * fator);
  const juros = arred(corrigido * jurosPct / 100);
  return { ...par, fator, corrigido, jurosPct, juros, total: arred(corrigido + juros), memoria };
}

export function calcular(p, idx) {
  const avisos = new Set();
  const regra = regras(p);
  const linhas = p.parcelas.map((par) => calcularParcela(par, p, idx, regra, avisos));
  const soma = (k) => arred(linhas.reduce((s, l) => s + (l[k] || 0), 0));
  const principal = soma("valor"), corrigido = soma("corrigido"), juros = soma("juros"), subtotal = soma("total");
  const multa = arred(subtotal * (Number(p.multa) || 0) / 100);
  const baseHon = p.honorarios_base === "sem_multa" ? subtotal : subtotal + multa;
  const honorarios = arred(baseHon * (Number(p.honorarios) || 0) / 100);
  const extras = (p.extras || []).map((e) => ({ ...e, valor: arred(Number(e.valor) || 0) }));
  const totalExtras = arred(extras.reduce((s, e) => s + e.valor, 0));
  return {
    linhas, avisos: [...avisos],
    totais: { principal, correcao: arred(corrigido - principal), corrigido, juros, subtotal, multa, honorarios, extras: totalExtras, total: arred(subtotal + multa + honorarios + totalExtras) },
  };
}

// Valida e normaliza os parâmetros vindos do formulário.
export function lerParametros(f) {
  const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  const num = (v) => { const s = String(v ?? "").trim().replace(/\s/g, ""); if (!s) return NaN; return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s); };
  const datas = f.getAll("parcela_data"), valores = f.getAll("parcela_valor"), descs = f.getAll("parcela_descricao");
  const parcelas = datas.map((d, i) => ({ data: data(d), valor: num(valores[i]), descricao: String(descs[i] || "").slice(0, 120) }))
    .filter((x) => x.data && Number.isFinite(x.valor) && x.valor !== 0);
  const extras = f.getAll("extra_descricao").map((d, i) => ({ descricao: String(d || "").slice(0, 120), valor: num(f.getAll("extra_valor")[i]) }))
    .filter((e) => e.descricao && Number.isFinite(e.valor) && e.valor !== 0);
  const regime = f.get("regime") in REGIMES ? f.get("regime") : "civel";
  return {
    titulo: String(f.get("titulo") || "").trim().slice(0, 150),
    processo_id: Number(f.get("processo_id")) || null,
    regime,
    indice_anterior: f.get("indice_anterior") in CORRECOES ? f.get("indice_anterior") : "ipca",
    correcao: f.get("correcao") in CORRECOES ? f.get("correcao") : "ipca",
    juros: f.get("juros") in JUROS ? f.get("juros") : "1am",
    aplicar_lei: f.get("aplicar_lei") !== "nao",
    juros_desde: f.get("juros_desde") === "marco" ? "marco" : "evento",
    marco: data(f.get("marco")),
    data_final: data(f.get("data_final")),
    multa: Math.max(0, Math.min(100, num(f.get("multa")) || 0)),
    honorarios: Math.max(0, Math.min(100, num(f.get("honorarios")) || 0)),
    honorarios_base: f.get("honorarios_base") === "sem_multa" ? "sem_multa" : "com_multa",
    observacoes: String(f.get("observacoes") || "").slice(0, 2000),
    parcelas,
    extras,
  };
}

export function validar(p) {
  if (!p.data_final) return "Informe a data do cálculo.";
  if (!p.parcelas.length) return "Informe ao menos uma parcela com data e valor.";
  if (p.parcelas.some((x) => x.data > p.data_final)) return "Há parcela com data posterior à data do cálculo.";
  if ((p.juros_desde === "marco" || p.regime === "trabalhista") && !p.marco) return `Informe a data do marco (${(REGIMES[p.regime] || REGIMES.civel).marco.toLowerCase()}).`;
  if (p.parcelas.length > 300) return "Máximo de 300 parcelas por cálculo.";
  return null;
}
