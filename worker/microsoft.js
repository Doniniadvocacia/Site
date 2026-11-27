// Integração com o Microsoft 365 (SharePoint/OneDrive) pela API Microsoft Graph.
// Um administrador conecta a conta Microsoft do escritório uma vez (OAuth com acesso delegado); o Diligo guarda o
// token de renovação cifrado e passa a listar, criar pastas e gravar arquivos na biblioteca do SharePoint escolhida.
// Segredos (Cloudflare): MS_CLIENT_ID, MS_CLIENT_SECRET; opcional MS_TENANT (padrão: organizations).
import { agora, cifrar, decifrar } from "./seguranca.js";
import { lerConfig, gravarConfig } from "./asaas.js";

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";
export const ESCOPOS = "offline_access User.Read Files.ReadWrite.All Sites.ReadWrite.All";
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
  const r = await fetch(`${base(env)}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: ESCOPOS, ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description?.split("\r\n")[0] || j.error || `Microsoft respondeu ${r.status}`);
  return j;
}

async function guardarTokens(env, j) {
  await gravarConfig(env, "ms_access", await cifrar(env, j.access_token));
  await gravarConfig(env, "ms_expira", String(agora() + Number(j.expires_in || 3600) - 120));
  if (j.refresh_token) await gravarConfig(env, "ms_refresh", await cifrar(env, j.refresh_token));
}

// Troca o código do retorno do login pelos tokens e registra quem conectou.
export async function concluirConexao(env, req, codigo, usuarioId) {
  const j = await pedirToken(env, { grant_type: "authorization_code", code: codigo, redirect_uri: urlRetorno(req) });
  await guardarTokens(env, j);
  const eu = await graph(env, "/me?$select=displayName,mail,userPrincipalName");
  await gravarConfig(env, "ms_conta", JSON.stringify({ nome: eu.displayName, email: eu.mail || eu.userPrincipalName }), usuarioId);
}

export async function desconectar(env, usuarioId) {
  for (const k of ["ms_access", "ms_expira", "ms_refresh", "ms_conta", "ms_site", "ms_drive", "ms_base"]) await gravarConfig(env, k, null, usuarioId);
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
export async function copiarParaPastaDoProcesso(env, processoId, arquivo) {
  try {
    if (!msConfigurado(env) || !arquivo || typeof arquivo === "string" || !arquivo.size || !processoId) return null;
    const p = await env.DB.prepare("SELECT sharepoint_drive, sharepoint_item FROM processos WHERE id = ?").bind(processoId).first();
    if (!p?.sharepoint_drive || !p?.sharepoint_item) return null;
    return await enviarArquivo(env, p.sharepoint_drive, p.sharepoint_item, arquivo.name, new Uint8Array(await arquivo.arrayBuffer()));
  } catch (e) {
    console.error("SharePoint:", e.message);
    await env.DB.prepare("INSERT INTO auditoria (usuario_id, acao, detalhe, criado_em) VALUES (NULL, 'sharepoint_erro', ?, ?)").bind(`processo ${processoId}: ${e.message}`.slice(0, 500), agora()).run().catch(() => {});
    return null;
  }
}

// ---------- Pastas automáticas: uma por processo, dentro da pasta raiz ----------
// Nome: "nº da pasta - Cliente x Parte Contrária" (sem pasta, usa o número do processo).
export function nomePastaProcesso(p) {
  const partes = [p.cliente, p.parte_contraria].map((x) => String(x || "").trim()).filter(Boolean).join(" x ");
  const numero = String(p.pasta || "").trim() || String(p.numero || "").trim() || `Processo ${p.id}`;
  return nomeArquivo(partes ? `${numero} - ${partes}` : numero);
}

const SELECT_AUTO = `SELECT p.id, p.pasta, p.numero, p.parte_contraria, c.nome AS cliente FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id
  WHERE p.sharepoint_item IS NULL AND p.sharepoint_ignorar = 0`;

export async function pendentesAutomaticos(env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM processos WHERE sharepoint_item IS NULL AND sharepoint_ignorar = 0").first())?.n || 0;
}

// Cria (ou reaproveita) a pasta de até `limite` processos sem vínculo. Uma pasta já existente na raiz é aproveitada
// quando tem exatamente o nome esperado ou começa com o nº da pasta ("35 - ..." ou "Pasta 35 - ...") e não está ligada a outro processo.
export async function vincularPastasAutomaticas(env, { limite = 20, processoId = null } = {}) {
  const alvo = await lerAlvo(env);
  if (!alvo.pronto) return { feitos: 0, criadas: 0, erros: [], restantes: 0 };
  const { results } = processoId
    ? await env.DB.prepare(`${SELECT_AUTO} AND p.id = ?`).bind(processoId).all()
    : await env.DB.prepare(`${SELECT_AUTO} ORDER BY p.id LIMIT ?`).bind(limite).all();
  const r = { feitos: 0, criadas: 0, erros: [] };
  if (results.length) {
    const naRaiz = (await listarPasta(env, alvo.drive.id, alvo.pasta.id, 40)).filter((x) => x.folder);
    const usadas = new Set((await env.DB.prepare("SELECT sharepoint_item FROM processos WHERE sharepoint_item IS NOT NULL").all()).results.map((x) => x.sharepoint_item));
    for (const p of results) {
      try {
        const nome = nomePastaProcesso(p);
        const pasta = String(p.pasta || "").trim().toLowerCase();
        let item = naRaiz.find((x) => x.name.toLowerCase() === nome.toLowerCase() && !usadas.has(x.id))
          || (pasta && naRaiz.find((x) => !usadas.has(x.id) && (x.name.toLowerCase().startsWith(`${pasta} - `) || x.name.toLowerCase().startsWith(`pasta ${pasta} - `))));
        if (!item) { item = await criarPasta(env, alvo.drive.id, alvo.pasta.id, nome); naRaiz.push(item); r.criadas++; }
        usadas.add(item.id);
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
