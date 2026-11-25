// Índices econômicos para os cálculos judiciais, carregados do SGS (Sistema Gerenciador de Séries Temporais) do Banco Central.
// Ficam gravados no banco (um valor por série e mês) e são atualizados automaticamente; não dependem de IA.
import { agora } from "./seguranca.js";

const API_PADRAO = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.";
export const INICIO_HISTORICO = "2000-01";

// Variações mensais em % (índices de preços) ou taxas mensais em % (juros).
export const SERIES = {
  ipca: { codigo: 433, nome: "IPCA (IBGE)", tipo: "correcao" },
  ipcae: { codigo: 10764, nome: "IPCA-E (IBGE)", tipo: "correcao" },
  inpc: { codigo: 188, nome: "INPC (IBGE)", tipo: "correcao" },
  igpm: { codigo: 189, nome: "IGP-M (FGV)", tipo: "correcao" },
  selic: { codigo: 4390, nome: "Taxa SELIC mensal", tipo: "juros" },
  taxa_legal: { codigo: 29543, nome: "Taxa legal (Lei 14.905/2024, Res. CMN 5.171)", tipo: "juros" },
  tr: { codigo: 7811, nome: "TR mensal", tipo: "juros" },
};

const somarMes = (mes, n) => {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const paraBr = (mes) => `01/${mes.slice(5, 7)}/${mes.slice(0, 4)}`;

async function buscarSerie(env, codigo, de, ate) {
  // O SGS limita cada consulta a 10 anos: busca em blocos de 9 anos.
  const itens = [];
  for (let ini = de; ini <= ate; ini = somarMes(ini, 108)) {
    const fim = somarMes(ini, 107) < ate ? somarMes(ini, 107) : ate;
    const url = `${env.BCB_API || API_PADRAO}${codigo}/dados?formato=json&dataInicial=${paraBr(ini)}&dataFinal=${paraBr(fim).replace(/^01/, "28")}`;
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Diligo/1.0 (Eduardo Donini Advocacia)" } });
    if (r.status === 404) continue; // período sem dados
    if (!r.ok) throw new Error(`Banco Central respondeu ${r.status} para a série ${codigo}`);
    const lote = await r.json();
    if (!Array.isArray(lote)) throw new Error(`Resposta inesperada do Banco Central para a série ${codigo}`);
    for (const it of lote) {
      const [d, m, a] = String(it.data || "").split("/");
      const v = Number(String(it.valor).replace(",", "."));
      if (a && m && Number.isFinite(v)) itens.push([`${a}-${m}`, v]);
    }
  }
  return itens;
}

// Atualiza as séries. Na primeira vez carrega o histórico desde 2000; depois, só os últimos 18 meses (o BC às vezes revisa valores recentes).
export async function atualizarIndices(env) {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7);
  const resumo = [];
  for (const [chave, s] of Object.entries(SERIES)) {
    try {
      const ultimo = await env.DB.prepare("SELECT MAX(mes) AS m FROM indices WHERE serie = ?").bind(chave).first();
      const de = ultimo?.m ? somarMes(ultimo.m, -18) : INICIO_HISTORICO;
      const itens = await buscarSerie(env, s.codigo, de < INICIO_HISTORICO ? INICIO_HISTORICO : de, hoje);
      const t = agora();
      for (let i = 0; i < itens.length; i += 80) {
        await env.DB.batch(itens.slice(i, i + 80).map(([mes, v]) => env.DB.prepare(
          "INSERT INTO indices (serie, mes, valor, atualizado_em) VALUES (?, ?, ?, ?) ON CONFLICT(serie, mes) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em")
          .bind(chave, mes, v, t)));
      }
      resumo.push({ serie: chave, meses: itens.length });
    } catch (e) {
      resumo.push({ serie: chave, erro: e.message });
    }
  }
  const erros = resumo.filter((r) => r.erro);
  await env.DB.prepare("INSERT INTO indices_atualizacoes (criado_em, resumo, erro) VALUES (?, ?, ?)")
    .bind(agora(), JSON.stringify(resumo), erros.length ? erros.map((e) => `${e.serie}: ${e.erro}`).join("; ").slice(0, 500) : null).run();
  return resumo;
}

// Atualização automática: no máximo uma vez a cada 12 horas.
export async function atualizarSePreciso(env) {
  const r = await env.DB.prepare("SELECT MAX(criado_em) AS t FROM indices_atualizacoes WHERE erro IS NULL").first();
  if (r?.t && agora() - r.t < 12 * 3600) return null;
  return atualizarIndices(env);
}

export async function carregarIndices(env) {
  const { results } = await env.DB.prepare("SELECT serie, mes, valor FROM indices").all();
  const mapa = Object.fromEntries(Object.keys(SERIES).map((k) => [k, new Map()]));
  for (const r of results) mapa[r.serie]?.set(r.mes, r.valor);
  return mapa;
}

export async function situacaoIndices(env) {
  const [{ results }, ult] = await Promise.all([
    env.DB.prepare("SELECT serie, MIN(mes) AS primeiro, MAX(mes) AS ultimo, COUNT(*) AS n FROM indices GROUP BY serie").all(),
    env.DB.prepare("SELECT criado_em, erro FROM indices_atualizacoes ORDER BY id DESC LIMIT 1").first(),
  ]);
  return { series: Object.fromEntries(results.map((r) => [r.serie, r])), ultima: ult };
}
