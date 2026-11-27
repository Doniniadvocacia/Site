// Integração com o Microsoft 365 (SharePoint/OneDrive) pela API Microsoft Graph.
// Um administrador conecta a conta Microsoft do escritório uma vez (OAuth com acesso delegado); o Diligo guarda o
// token de renovação cifrado e passa a listar, criar pastas e gravar arquivos na biblioteca do SharePoint escolhida.
// Segredos (Cloudflare): MS_CLIENT_ID, MS_CLIENT_SECRET; opcional MS_TENANT (padrão: organizations).
import { agora, cifrar, decifrar, decifrarBytes } from "./seguranca.js";
import { baixarDoWix } from "./anexos.js";
import { lerConfig, gravarConfig } from "./asaas.js";

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
// Permissões pedidas no login. A renovação do token usa as que a Microsoft de fato concedeu (guardadas em ms_escopos),
// para que uma conta conectada antes da agenda do Outlook continue funcionando até ser reconectada.
const ESCOPOS_ANTIGOS = "offline_access User.Read Files.ReadWrite.All Sites.ReadWrite.All";
export const ESCOPOS = `${ESCOPOS_ANTIGOS} Calendars.ReadWrite`;
const LIMITE_SIMPLES = 4 * 1024 * 1024;     // até 4 MB: envio direto; acima, sessão de envio em partes
const PARTE = 320 * 1024 * 10;              // 3,125 MB (múltiplo de 320 KB, exigido pela Microsoft)

export const msConfigurado = (env) => Boolean(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
const base = (env) => `${env.MS_LOGIN || LOGIN}/${env.MS_TENANT || "organizations"}/oauth2/v2.0`;
const graphUrl = (env, caminho) => (/^https?:\/\//.test(caminho) ? caminho : `${env.MS_GRAPH || GRAPH}${caminho}`);
export const urlRetorno = (req) => `${new URL(req.url).origin}/sistema/microsoft/retorno`;

export function urlAutorizacao(env, req, estado) {
  const p = new URLSearchParams({ client_id: env.MS_CLIENT_ID, response_type: "code", redirect_uri: urlRetorno(req), response_mode: "query", scope: ESCOPOS, state: estado, prompt: "select_account" });
  return `${base(env)}/authorize?${p}`;
}

async function pedirToken(env, corpo) {
  const escopos = corpo.grant_type === "refresh_token" ? ((await lerConfig(env, "ms_escopos")) || ESCOPOS_ANTIGOS) : ESCOPOS;
  const r = await fetch(`${base(env)}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: escopos, ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description?.split("\r\n")[0] || j.error || `Microsoft respondeu ${r.status}`);
  return j;
}

async function guardarTokens(env, j) {
  await gravarConfig(env, "ms_access", await cifrar(env, j.access_token));
  await gravarConfig(env, "ms_expira", String(agora() + Number(j.expires_in || 3600) - 120));
  if (j.refresh_token) await gravarConfig(env, "ms_refresh", await cifrar(env, j.refresh_token));
  if (j.scope) await gravarConfig(env, "ms_escopos", /offline_access/i.test(j.scope) ? j.scope : `offline_access ${j.scope}`);
}

// A agenda do Outlook está liberada quando a conta conectada concedeu Calendars.ReadWrite.
export async function outlookLiberado(env) {
  if (!msConfigurado(env) || !(await lerConfig(env, "ms_conta"))) return false;
  return /Calendars\.ReadWrite/i.test((await lerConfig(env, "ms_escopos")) || "");
}

// Troca o código do retorno do login pelos tokens e registra quem conectou.
export async function concluirConexao(env, req, codigo, usuarioId) {
  const j = await pedirToken(env, { grant_type: "authorization_code", code: codigo, redirect_uri: urlRetorno(req) });
  await guardarTokens(env, j);
  const eu = await graph(env, "/me?$select=displayName,mail,userPrincipalName");
  await gravarConfig(env, "ms_conta", JSON.stringify({ nome: eu.displayName, email: eu.mail || eu.userPrincipalName }), usuarioId);
}

export async function desconectar(env, usuarioId) {
  for (const k of ["ms_access", "ms_expira", "ms_refresh", "ms_conta", "ms_escopos", "ms_site", "ms_drive", "ms_base"]) await gravarConfig(env, k, null, usuarioId);
}

async function tokenAcesso(env) {
  const exp = Number(await lerConfig(env, "ms_expira")) || 0;
  if (exp > agora()) { const t = await decifrar(env, await lerConfig(env, "ms_access")); if (t) return t; }
  const rt = await decifrar(env, await lerConfig(env, "ms_refresh"));
  if (!rt) throw new Error("O Microsoft 365 não está conectado. Um administrador precisa conectar em Configurações › Microsoft 365.");
  const j = await pedirToken(env, { grant_type: "refresh_token", refresh_token: rt });
  await guardarTokens(env, j);
  return j.access_token;
}

// Chamada à API Graph. corpo: objeto (JSON) ou bytes (Uint8Array).
export async function graph(env, caminho, { metodo = "GET", corpo = null, cabecalhos = {} } = {}) {
  const token = await tokenAcesso(env);
  const bin = corpo instanceof Uint8Array;
  const r = await fetch(graphUrl(env, caminho), {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo && !bin ? { "Content-Type": "application/json" } : {}), ...cabecalhos },
    body: corpo ? (bin ? corpo : JSON.stringify(corpo)) : undefined,
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || `Microsoft Graph respondeu ${r.status}`;
    throw new Error(r.status === 403 ? `Sem permissão no SharePoint: ${msg}` : r.status === 404 ? "Pasta ou arquivo não encontrado no SharePoint (pode ter sido movido ou excluído)." : msg);
  }
  return j;
}

// ---------- Configuração da biblioteca ----------
export async function lerAlvo(env) {
  const ler = async (k) => { try { return JSON.parse((await lerConfig(env, k)) || "null"); } catch { return null; } };
  const [conta, site, drive, pasta] = await Promise.all([ler("ms_conta"), ler("ms_site"), ler("ms_drive"), ler("ms_base")]);
  return { conta, site, drive, pasta, pronto: Boolean(conta && drive && pasta) };
}
// Aceita o nome do site ou o endereço copiado do navegador (https://empresa.sharepoint.com/sites/Nome/...).
export async function buscarSites(env, q) {
  const texto = String(q || "").trim();
  if (/^https?:\/\//i.test(texto)) {
    let u; try { u = new URL(texto); } catch { return []; }
    if (!/\.sharepoint\.com$/i.test(u.hostname)) return [];
    const m = u.pathname.match(/^\/(sites|teams)\/[^/]+/i);
    const caminho = m ? `/sites/${u.hostname}:${decodeURIComponent(m[0])}` : `/sites/${u.hostname}`;
    try { return [await graph(env, `${caminho}?$select=id,displayName,webUrl,name`)]; } catch { return []; }
  }
  return (await graph(env, `/sites?search=${encodeURIComponent(texto || "*")}&$select=id,displayName,webUrl,name`)).value || [];
}
export const bibliotecas = async (env, siteId) => (await graph(env, `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl`)).value || [];

const SELECAO = "$select=id,name,folder,file,size,lastModifiedDateTime,webUrl,parentReference&$top=200&$orderby=name";
export async function listarPasta(env, driveId, itemId, paginas = 5) {
  const caminho = itemId && itemId !== "root" ? `/drives/${driveId}/items/${itemId}/children?${SELECAO}` : `/drives/${driveId}/root/children?${SELECAO}`;
  const itens = [];
  let url = caminho;
  for (let i = 0; url && i < paginas; i++) { const j = await graph(env, url); itens.push(...(j.value || [])); url = j["@odata.nextLink"] || null; }
  return itens;
}
export const lerItem = (env, driveId, itemId) => graph(env, itemId && itemId !== "root" ? `/drives/${driveId}/items/${itemId}?$select=id,name,webUrl,parentReference,folder` : `/drives/${driveId}/root?$select=id,name,webUrl,folder`);

export async function criarPasta(env, driveId, paiId, nome) {
  const pai = paiId && paiId !== "root" ? `/drives/${driveId}/items/${paiId}/children` : `/drives/${driveId}/root/children`;
  return graph(env, pai, { metodo: "POST", corpo: { name: nomeArquivo(nome), folder: {}, "@microsoft.graph.conflictBehavior": "rename" } });
}

// Nomes aceitos pelo SharePoint (sem " * : < > ? / \ | e sem espaço/ponto no fim).
export const nomeArquivo = (n) => String(n || "arquivo").replace(/["*:<>?/\\|#%\x00-\x1f]/g, "-").replace(/[\s.]+$/, "").slice(0, 200) || "arquivo";

export async function enviarArquivo(env, driveId, pastaId, nome, dados) {
  const alvo = `/drives/${driveId}/items/${pastaId}:/${encodeURIComponent(nomeArquivo(nome))}:`;
  if (dados.length <= LIMITE_SIMPLES) {
    return graph(env, `${alvo}/content?@microsoft.graph.conflictBehavior=rename`, { metodo: "PUT", corpo: dados, cabecalhos: { "Content-Type": "application/octet-stream" } });
  }
  const sessao = await graph(env, `${alvo}/createUploadSession`, { metodo: "POST", corpo: { item: { "@microsoft.graph.conflictBehavior": "rename" } } });
  let resposta = null;
  for (let ini = 0; ini < dados.length; ini += PARTE) {
    const fim = Math.min(ini + PARTE, dados.length);
    // A URL da sessão já é autorizada: não leva o token.
    const r = await fetch(sessao.uploadUrl, { method: "PUT", headers: { "Content-Length": String(fim - ini), "Content-Range": `bytes ${ini}-${fim - 1}/${dados.length}` }, body: dados.slice(ini, fim) });
    if (!r.ok && r.status !== 202) throw new Error(`Falha no envio ao SharePoint (${r.status}).`);
    resposta = await r.json().catch(() => null);
  }
  return resposta;
}

// Cópia de um anexo do Diligo para a pasta do processo no SharePoint (se houver). Nunca impede a gravação no Diligo.
export async function copiarParaPastaDoProcesso(env, processoId, arquivo, anexoId = null) {
  try {
    if (!msConfigurado(env) || !arquivo || typeof arquivo === "string" || !arquivo.size || !processoId) return null;
    const p = await env.DB.prepare("SELECT sharepoint_drive, sharepoint_item FROM processos WHERE id = ?").bind(processoId).first();
    if (!p?.sharepoint_drive || !p?.sharepoint_item) return null;
    const item = await enviarArquivo(env, p.sharepoint_drive, p.sharepoint_item, arquivo.name, new Uint8Array(await arquivo.arrayBuffer()));
    if (anexoId && item?.id) await env.DB.prepare("UPDATE anexos SET sharepoint_item = ?, sharepoint_erro = NULL WHERE id = ?").bind(item.id, anexoId).run();
    return item;
  } catch (e) {
    console.error("SharePoint:", e.message);
    await env.DB.prepare("INSERT INTO auditoria (usuario_id, acao, detalhe, criado_em) VALUES (NULL, 'sharepoint_erro', ?, ?)").bind(`processo ${processoId}: ${e.message}`.slice(0, 500), agora()).run().catch(() => {});
    return null;
  }
}

// ---------- Pastas automáticas: pasta raiz › cliente › processo ----------
// Pasta do processo (dentro da do cliente): "nº da pasta - Parte Contrária" (sem pasta, usa o número do processo).
export function nomePastaProcesso(p) {
  const numero = String(p.pasta || "").trim() || String(p.numero || "").trim() || `Processo ${p.id}`;
  const parte = String(p.parte_contraria || "").trim();
  return nomeArquivo(parte ? `${numero} - ${parte}` : numero);
}
// Padrão anterior (na raiz): "nº - Cliente x Parte Contrária". Pastas com esse nome são renomeadas ao reorganizar.
function nomeAntigo(p) {
  const partes = [p.cliente, p.parte_contraria].map((x) => String(x || "").trim()).filter(Boolean).join(" x ");
  const numero = String(p.pasta || "").trim() || String(p.numero || "").trim() || `Processo ${p.id}`;
  return nomeArquivo(partes ? `${numero} - ${partes}` : numero);
}
export const nomePastaCliente = (c) => nomeArquivo(String(c?.cliente || "").trim() || "Sem cliente");

const SELECT_PROC = `SELECT p.id, p.pasta, p.numero, p.parte_contraria, p.cliente_id, p.sharepoint_item, p.sharepoint_nome, c.nome AS cliente, c.sharepoint_item AS cliente_pasta
  FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id`;

export async function pendentesAutomaticos(env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM processos WHERE sharepoint_item IS NULL AND sharepoint_ignorar = 0").first())?.n || 0;
}

const comecaPelaPasta = (nome, pasta) => pasta && (nome.toLowerCase().startsWith(`${pasta} - `) || nome.toLowerCase().startsWith(`pasta ${pasta} - `) || nome.toLowerCase() === pasta || nome.toLowerCase() === `pasta ${pasta}`);

// Contexto de um lote: conteúdo da raiz e das pastas de cliente já consultadas, e itens já ligados a algum processo.
async function contexto(env, alvo) {
  const raiz = (await listarPasta(env, alvo.drive.id, alvo.pasta.id, 40)).filter((x) => x.folder);
  const usadas = new Set((await env.DB.prepare("SELECT sharepoint_item FROM processos WHERE sharepoint_item IS NOT NULL").all()).results.map((x) => x.sharepoint_item));
  const doCliente = new Set((await env.DB.prepare("SELECT sharepoint_item FROM clientes WHERE sharepoint_item IS NOT NULL").all()).results.map((x) => x.sharepoint_item));
  return { alvo, raiz, usadas, doCliente, filhos: new Map(), clientes: new Map() };
}

// Pasta do cliente: a já registrada; senão, uma pasta da raiz com o nome do cliente que não seja de outro cliente nem de processo; senão, cria.
async function pastaDoCliente(env, ctx, p) {
  const chave = p.cliente_id || 0;
  if (ctx.clientes.has(chave)) return ctx.clientes.get(chave);
  let item = p.cliente_pasta ? ctx.raiz.find((x) => x.id === p.cliente_pasta) : null;
  if (!item && p.cliente_pasta) { try { item = await lerItem(env, ctx.alvo.drive.id, p.cliente_pasta); if (!item?.folder) item = null; } catch { item = null; } }
  if (!item) {
    const nome = nomePastaCliente(p);
    item = ctx.raiz.find((x) => x.name.toLowerCase() === nome.toLowerCase() && !ctx.usadas.has(x.id) && (!ctx.doCliente.has(x.id)));
    if (!item) { item = await criarPasta(env, ctx.alvo.drive.id, ctx.alvo.pasta.id, nome); ctx.raiz.push(item); }
    if (p.cliente_id) { await env.DB.prepare("UPDATE clientes SET sharepoint_item = ? WHERE id = ?").bind(item.id, p.cliente_id).run(); ctx.doCliente.add(item.id); }
  }
  ctx.clientes.set(chave, item);
  return item;
}
async function filhosDe(env, ctx, pastaId) {
  if (!ctx.filhos.has(pastaId)) ctx.filhos.set(pastaId, (await listarPasta(env, ctx.alvo.drive.id, pastaId, 20)).filter((x) => x.folder));
  return ctx.filhos.get(pastaId);
}

// Move (e, se tiver o nome do padrão antigo, renomeia) uma pasta para dentro da pasta do cliente.
async function moverPasta(env, ctx, itemId, destinoId, novoNome = null) {
  const corpo = { parentReference: { id: destinoId }, ...(novoNome ? { name: novoNome } : {}) };
  return graph(env, `/drives/${ctx.alvo.drive.id}/items/${encodeURIComponent(itemId)}?@microsoft.graph.conflictBehavior=rename`, { metodo: "PATCH", corpo });
}

// Cria (ou reaproveita) a pasta de até `limite` processos sem vínculo, dentro da pasta do cliente. Reaproveita uma pasta
// livre com o nome esperado ou que comece pelo nº da pasta ("35 - ..." ou "Pasta 35 - ..."): primeiro dentro da pasta do
// cliente; depois na raiz (nesse caso, ela é movida para a pasta do cliente).
export async function vincularPastasAutomaticas(env, { limite = 20, processoId = null } = {}) {
  const alvo = await lerAlvo(env);
  if (!alvo.pronto) return { feitos: 0, criadas: 0, erros: [], restantes: 0 };
  const { results } = processoId
    ? await env.DB.prepare(`${SELECT_PROC} WHERE p.sharepoint_item IS NULL AND p.sharepoint_ignorar = 0 AND p.id = ?`).bind(processoId).all()
    : await env.DB.prepare(`${SELECT_PROC} WHERE p.sharepoint_item IS NULL AND p.sharepoint_ignorar = 0 ORDER BY p.cliente_id, p.id LIMIT ?`).bind(limite).all();
  const r = { feitos: 0, criadas: 0, erros: [] };
  if (results.length) {
    const ctx = await contexto(env, alvo);
    for (const p of results) {
      try {
        const nome = nomePastaProcesso(p), antigo = nomeAntigo(p);
        const pasta = String(p.pasta || "").trim().toLowerCase();
        const cli = await pastaDoCliente(env, ctx, p);
        const dentro = await filhosDe(env, ctx, cli.id);
        const livre = (x) => !ctx.usadas.has(x.id) && !ctx.doCliente.has(x.id);
        let item = dentro.find((x) => livre(x) && x.name.toLowerCase() === nome.toLowerCase()) || dentro.find((x) => livre(x) && comecaPelaPasta(x.name, pasta));
        if (!item) {
          const naRaiz = ctx.raiz.find((x) => livre(x) && [nome, antigo].some((n) => x.name.toLowerCase() === n.toLowerCase())) || ctx.raiz.find((x) => livre(x) && comecaPelaPasta(x.name, pasta));
          if (naRaiz) { item = await moverPasta(env, ctx, naRaiz.id, cli.id, naRaiz.name === antigo ? nome : null); ctx.raiz.splice(ctx.raiz.indexOf(naRaiz), 1); dentro.push(item); }
        }
        if (!item) { item = await criarPasta(env, alvo.drive.id, cli.id, nome); dentro.push(item); r.criadas++; }
        ctx.usadas.add(item.id);
        await env.DB.prepare("UPDATE processos SET sharepoint_drive = ?, sharepoint_item = ?, sharepoint_nome = ?, sharepoint_url = ? WHERE id = ? AND sharepoint_item IS NULL")
          .bind(alvo.drive.id, item.id, item.name, item.webUrl || null, p.id).run();
        r.feitos++;
      } catch (e) {
        r.erros.push(`processo ${p.id}: ${e.message}`);
        if (/401|403|token|autoriza/i.test(e.message)) break; // problema na conexão: não adianta seguir
      }
    }
  }
  r.restantes = await pendentesAutomaticos(env);
  return r;
}

// Pasta do cliente criada já no cadastro da pessoa (quando marcada como cliente do escritório).
export async function garantirPastaCliente(env, clienteId) {
  const alvo = await lerAlvo(env);
  if (!alvo.pronto) return null;
  const c = await env.DB.prepare("SELECT id, nome, sharepoint_item FROM clientes WHERE id = ?").bind(clienteId).first();
  if (!c) return null;
  try {
    const ctx = await contexto(env, alvo);
    if (c.sharepoint_item && ctx.raiz.some((x) => x.id === c.sharepoint_item)) return { item: c.sharepoint_item };
    const item = await pastaDoCliente(env, ctx, { cliente_id: c.id, cliente: c.nome, cliente_pasta: c.sharepoint_item });
    return { item: item.id };
  } catch (e) { return { erro: e.message }; }
}

// Pastas de processo vinculadas que ainda estão soltas na raiz (organização anterior, sem a pasta do cliente).
async function soltasNaRaiz(env, alvo) {
  const raiz = new Set((await listarPasta(env, alvo.drive.id, alvo.pasta.id, 40)).filter((x) => x.folder).map((x) => x.id));
  const { results } = await env.DB.prepare(`${SELECT_PROC} WHERE p.sharepoint_item IS NOT NULL AND p.sharepoint_drive = ? ORDER BY p.cliente_id, p.id`).bind(alvo.drive.id).all();
  return results.filter((p) => raiz.has(p.sharepoint_item));
}
export async function paraOrganizar(env) {
  const alvo = await lerAlvo(env);
  if (!alvo.pronto) return 0;
  return (await soltasNaRaiz(env, alvo)).length;
}

// Move para a pasta do cliente até `limite` pastas de processo que estão na raiz. Os arquivos vão junto e o vínculo
// no Diligo continua o mesmo (o identificador da pasta não muda). Pastas no padrão antigo ganham o nome novo.
export async function organizarPorCliente(env, { limite = 15 } = {}) {
  const alvo = await lerAlvo(env);
  if (!alvo.pronto) return { movidas: 0, erros: [], restantes: 0 };
  const lista = (await soltasNaRaiz(env, alvo)).slice(0, limite);
  const r = { movidas: 0, erros: [] };
  if (lista.length) {
    const ctx = await contexto(env, alvo);
    for (const p of lista) {
      try {
        const cli = await pastaDoCliente(env, ctx, p);
        const atual = ctx.raiz.find((x) => x.id === p.sharepoint_item);
        const renomear = atual && atual.name === nomeAntigo(p) ? nomePastaProcesso(p) : null;
        const item = await moverPasta(env, ctx, p.sharepoint_item, cli.id, renomear);
        await env.DB.prepare("UPDATE processos SET sharepoint_nome = ?, sharepoint_url = ? WHERE id = ?").bind(item.name, item.webUrl || null, p.id).run();
        r.movidas++;
      } catch (e) {
        r.erros.push(`processo ${p.id}: ${e.message}`);
        if (/401|403|token|autoriza/i.test(e.message)) break;
      }
    }
  }
  r.restantes = await paraOrganizar(env);
  return r;
}

// ---------- Documentos já guardados no Diligo → pasta do processo no SharePoint ----------
// Anexos do histórico (inclui comprovantes de protocolo) de processos com pasta vinculada. Os do financeiro não vão:
// são de acesso restrito. Um arquivo com o mesmo nome e tamanho já presente na pasta não é enviado de novo.
const FILTRO_MIGRAR = `FROM anexos a JOIN historico h ON h.anexo_id = a.id JOIN processos p ON p.id = h.processo_id
  WHERE a.contexto = 'historico' AND a.sharepoint_item IS NULL AND p.sharepoint_item IS NOT NULL AND (a.chave IS NOT NULL OR a.origem_wix IS NOT NULL)`;

export async function situacaoMigracao(env) {
  const r = await env.DB.prepare(`SELECT COUNT(DISTINCT a.id) AS total, COUNT(DISTINCT CASE WHEN a.sharepoint_erro IS NOT NULL THEN a.id END) AS erros, COUNT(DISTINCT p.id) AS processos ${FILTRO_MIGRAR}`).first();
  return { pendentes: r?.total || 0, erros: r?.erros || 0, processos: r?.processos || 0 };
}

export async function migrarAnexos(env, { limite = 8, repetirErros = false } = {}) {
  const { results } = await env.DB.prepare(`SELECT a.id, a.nome, a.chave, a.origem_wix, a.tamanho, MIN(h.processo_id) AS processo_id, p.sharepoint_drive, p.sharepoint_item AS pasta
    ${FILTRO_MIGRAR} ${repetirErros ? "" : "AND a.sharepoint_erro IS NULL"} GROUP BY a.id ORDER BY a.id LIMIT ?`).bind(limite).all();
  const r = { enviados: 0, existentes: 0, erros: [] };
  const naPasta = new Map();
  for (const a of results) {
    try {
      if (!naPasta.has(a.pasta)) naPasta.set(a.pasta, (await listarPasta(env, a.sharepoint_drive, a.pasta, 20)).filter((x) => x.file));
      const arquivos = naPasta.get(a.pasta);
      const nome = nomeArquivo(a.nome);
      let dados = null;
      if (a.chave) {
        if (!env.ARQUIVOS) throw new Error("armazenamento de anexos indisponível");
        const obj = await env.ARQUIVOS.get(a.chave);
        if (!obj) throw new Error("arquivo não encontrado no armazenamento do Diligo");
        dados = new Uint8Array(await decifrarBytes(env, await obj.arrayBuffer()));
      } else {
        dados = (await baixarDoWix(env, a.origem_wix)).dados; // ainda não copiado do Wix: vai direto para o SharePoint
      }
      const igual = arquivos.find((x) => x.name.toLowerCase() === nome.toLowerCase() && Number(x.size) === dados.length);
      let item = igual;
      if (igual) r.existentes++;
      else { item = await enviarArquivo(env, a.sharepoint_drive, a.pasta, nome, dados); arquivos.push({ ...item, size: dados.length }); r.enviados++; }
      await env.DB.prepare("UPDATE anexos SET sharepoint_item = ?, sharepoint_erro = NULL WHERE id = ?").bind(item.id, a.id).run();
    } catch (e) {
      r.erros.push(`${a.nome}: ${e.message}`);
      await env.DB.prepare("UPDATE anexos SET sharepoint_erro = ? WHERE id = ?").bind(String(e.message).slice(0, 200), a.id).run();
      if (/401|token|autoriza|conectad/i.test(e.message)) break;
    }
  }
  return { ...r, ...(await situacaoMigracao(env)) };
}
