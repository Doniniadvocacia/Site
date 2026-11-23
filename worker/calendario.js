// Cálculo de prazos processuais.
// Regras aplicadas:
// - DJEN (Lei 11.419/2006, art. 4º, §§ 3º e 4º): considera-se publicada no 1º dia útil seguinte
//   à disponibilização; o prazo começa no 1º dia útil seguinte à publicação.
// - CPC, art. 219: prazos em dias contam só dias úteis.
// - CPC, art. 220: suspensão dos prazos de 20 de dezembro a 20 de janeiro.
// - CPC, art. 224: exclui o dia do começo, inclui o do vencimento; vencimento em dia não útil
//   é prorrogado para o 1º dia útil seguinte.
// Feriados nacionais (incluindo os móveis) são calculados aqui; os locais vêm da tabela feriados.
// O resultado é um apoio: a conferência do prazo continua sendo do advogado responsável.

const DIA = 86400000;
const paraData = (s) => new Date(`${s}T12:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const somarDias = (s, n) => iso(new Date(paraData(s).getTime() + n * DIA));
export const hojeBR = () => iso(new Date(Date.now() - 3 * 3600000));

function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// Feriados nacionais e dias sem expediente forense em todo o país.
export function feriadosNacionais(ano) {
  const p = pascoa(ano);
  const fixos = [
    ["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
    ["11-15", "Proclamação da República"], ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"],
    ["12-25", "Natal"],
  ].map(([md, nome]) => [`${ano}-${md}`, nome]);
  const moveis = [
    [somarDias(p, -48), "Carnaval (segunda-feira)"], [somarDias(p, -47), "Carnaval (terça-feira)"],
    [somarDias(p, -2), "Sexta-feira Santa"], [somarDias(p, 60), "Corpus Christi"],
  ];
  return [...fixos, ...moveis].sort((a, b) => a[0].localeCompare(b[0]));
}

const emRecesso = (s) => { const md = s.slice(5); return md >= "12-20" || md <= "01-20"; };

// locais: Set de datas AAAA-MM-DD cadastradas na tabela feriados
export function criarCalendario(locais = new Set()) {
  const cache = new Map();
  const nacionais = (ano) => {
    if (!cache.has(ano)) cache.set(ano, new Set(feriadosNacionais(ano).map(([d]) => d)));
    return cache.get(ano);
  };
  const diaUtil = (s) => {
    const dow = paraData(s).getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !nacionais(Number(s.slice(0, 4))).has(s) && !locais.has(s);
  };
  const proximoUtil = (s) => { let d = s; while (!diaUtil(d)) d = somarDias(d, 1); return d; };
  // Dia em que o prazo pode correr: útil e fora do recesso.
  const corre = (s) => diaUtil(s) && !emRecesso(s);

  return {
    diaUtil,
    proximoUtil,
    publicacaoDjen: (disponibilizacao) => proximoUtil(somarDias(disponibilizacao, 1)),

    // dataInicial = data da publicação/intimação (o dia do começo é excluído)
    calcular({ dataInicial, dias, contagem = "uteis", antecedencia = 2 }) {
      dias = Number(dias);
      if (!dataInicial || !Number.isInteger(dias) || dias < 1 || dias > 365) return null;
      let d = dataInicial, contados = 0, guarda = 0;
      if (contagem === "corridos") {
        while (contados < dias && guarda++ < 2000) { d = somarDias(d, 1); if (!emRecesso(d)) contados++; }
        while ((!diaUtil(d) || emRecesso(d)) && guarda++ < 2000) d = somarDias(d, 1);
      } else {
        while (contados < dias && guarda++ < 2000) { d = somarDias(d, 1); if (corre(d)) contados++; }
      }
      const fatal = d;
      let interno = fatal, volta = 0;
      while (volta < antecedencia && guarda++ < 3000) { interno = somarDias(interno, -1); if (diaUtil(interno)) volta++; }
      return { fatal, interno: antecedencia > 0 ? interno : fatal };
    },
  };
}

export async function calendarioDoBanco(env) {
  const { results } = await env.DB.prepare("SELECT data FROM feriados").all();
  return criarCalendario(new Set(results.map((r) => r.data)));
}

// Converte datas vindas do Wix/DJEN ("15/03/2026", "2026-03-15T...", {"$date": ...}) para AAAA-MM-DD.
export function normalizarData(v) {
  if (!v) return null;
  if (typeof v === "object" && v.$date) v = v.$date;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
