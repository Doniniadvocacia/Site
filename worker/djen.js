// Captura de intimações no DJEN (Diário de Justiça Eletrônico Nacional), API pública do CNJ.
// Busca por OAB nos últimos dias, grava só o que é novo e deixa na fila de triagem.
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
    if (!r.ok) throw new Error(`DJEN respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const lote = j.items || j.itens || j.content || [];
    itens.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }
  return itens;
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
  return resumo;
}
