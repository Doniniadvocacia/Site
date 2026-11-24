// Captura de intimações no DJEN (Diário de Justiça Eletrônico Nacional), API pública do CNJ.
// Busca por OAB nos últimos dias, grava só o que é novo e deixa na fila de triagem.
import { notificar, idsPorPerfil } from "./notificacoes.js";
import { agora, sha256 } from "./seguranca.js";
import { calendarioDoBanco, normalizarData, somarDias, hojeBR } from "./calendario.js";

const API_PADRAO = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
const JANELA_DIAS = 10;      // revisita os últimos dias para não perder nada
const POR_PAGINA = 100;
const MAX_PAGINAS = 20;

const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const primeiro = (o, ...chaves) => { for (const k of chaves) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return null; };

async function buscarOab(api, numero, uf, inicio, fim) {
  const itens = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `${api}?numeroOab=${encodeURIComponent(numero)}&ufOab=${encodeURIComponent(uf)}` +
      `&dataDisponibilizacaoInicio=${inicio}&dataDisponibilizacaoFim=${fim}&pagina=${pagina}&itensPorPagina=${POR_PAGINA}`;
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Diligo/1.0 (Eduardo Donini Advocacia)" } });
    if (!r.ok) {
      const corpo = (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      // O DJEN fica atrás de um bloqueio de rede que recusa acessos de fora do Brasil (comum nas execuções agendadas).
      if (r.status === 403) throw new Error("DJEN recusou o acesso (403) a partir deste servidor da Cloudflare — bloqueio de rede para acessos de fora do Brasil. A captura será refeita automaticamente quando a equipe usar o sistema.");
      throw new Error(`DJEN respondeu ${r.status}${corpo ? `: ${corpo}` : ""}`);
    }
    const j = await r.json();
    const lote = j.items || j.itens || j.content || [];
    itens.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }
  return itens;
}

// Captura de reserva: as execuções agendadas rodam em servidores da Cloudflare que podem estar fora do Brasil,
// e o DJEN recusa esses acessos. Quando alguém da equipe abre o sistema (a partir do Brasil) e a última captura
// bem-sucedida é anterior ao horário programado mais recente (7h ou 13h, dias úteis), a captura é refeita em segundo plano.
export async function capturaPendente(env) {
  const agoraBR = new Date(Date.now() - 3 * 3600000);
  const dia = agoraBR.getUTCDay(), hora = agoraBR.getUTCHours();
  if (dia === 0 || dia === 6 || hora < 7) return false;
  const marco = Date.UTC(agoraBR.getUTCFullYear(), agoraBR.getUTCMonth(), agoraBR.getUTCDate(), hora >= 13 ? 13 : 7) / 1000 + 3 * 3600;
  const r = await env.DB.prepare(`SELECT MAX(CASE WHEN erro IS NULL THEN criado_em END) AS ok, MAX(criado_em) AS tentativa,
      (SELECT COUNT(*) FROM oabs WHERE ativo = 1) AS oabs FROM capturas`).first();
  if (!r?.oabs) return false;
  const ultimaOk = r?.ok || 0, ultimaTentativa = r?.tentativa || 0;
  return ultimaOk < marco && agora() - ultimaTentativa > 20 * 60; // no máximo uma tentativa a cada 20 minutos
}

// Executa a captura de todas as OABs ativas. Retorna um resumo por OAB.
export async function capturarDjen(env, origem = "agendada") {
  const { results: oabs } = await env.DB.prepare("SELECT numero, uf FROM oabs WHERE ativo = 1").all();
  if (!oabs.length) return [{ oab: "-", erro: "Nenhuma OAB cadastrada para monitorar." }];

  const cal = await calendarioDoBanco(env);
  const fim = hojeBR();
  const inicio = somarDias(fim, -JANELA_DIAS);
  const { results: procs } = await env.DB.prepare("SELECT id, numero FROM processos WHERE numero IS NOT NULL").all();
  const porNumero = new Map(procs.map((p) => [soDigitos(p.numero), p.id]));
  const resumo = [];

  for (const { numero, uf } of oabs) {
    const rotulo = `${numero}/${uf}`;
    try {
      const itens = await buscarOab(env.DJEN_API || API_PADRAO, numero, uf, inicio, fim);
      let novas = 0;
      for (const it of itens) {
        const djenId = primeiro(it, "id", "idComunicacao");
        const texto = primeiro(it, "texto", "conteudo") || "";
        const numeroProc = primeiro(it, "numeroprocessocommascara", "numeroProcessoComMascara", "numero_processo", "numeroProcesso") || "";
        const disp = normalizarData(primeiro(it, "data_disponibilizacao", "dataDisponibilizacao", "datadisponibilizacao"));
        const hash = primeiro(it, "hash") || (await sha256(`${djenId}|${numeroProc}|${disp}|${texto.slice(0, 500)}`));
        const r = await env.DB.prepare(
          `INSERT INTO publicacoes (djen_id, hash, data_disponibilizacao, data_publicacao, tribunal, orgao, tipo, numero_processo,
             processo_id, texto, link, oab, situacao, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)
           ON CONFLICT DO NOTHING`
        ).bind(djenId ? String(djenId) : null, hash, disp, disp ? cal.publicacaoDjen(disp) : null,
          primeiro(it, "siglaTribunal", "tribunal"), primeiro(it, "nomeOrgao", "orgao"), primeiro(it, "tipoComunicacao", "tipoDocumento", "tipo"),
          numeroProc, porNumero.get(soDigitos(numeroProc)) ?? null, texto, primeiro(it, "link"), rotulo, agora()).run();
        if (r.meta.changes) novas++;
      }
      await env.DB.prepare("INSERT INTO capturas (origem, oab, encontradas, novas, criado_em) VALUES (?, ?, ?, ?, ?)")
        .bind(origem, rotulo, itens.length, novas, agora()).run();
      resumo.push({ oab: rotulo, encontradas: itens.length, novas });
    } catch (e) {
      await env.DB.prepare("INSERT INTO capturas (origem, oab, erro, criado_em) VALUES (?, ?, ?, ?)")
        .bind(origem, rotulo, e.message.slice(0, 500), agora()).run();
      resumo.push({ oab: rotulo, erro: e.message });
    }
  }
  const total = resumo.reduce((n, r) => n + (r.novas || 0), 0);
  if (total) await notificar(env, { destinos: await idsPorPerfil(env, ["admin", "advogado"]), tipo: "intimacao", link: "/sistema/publicacoes",
    texto: `${total} nova(s) intimação(ões) do DJEN para triagem` });
  return resumo;
}
