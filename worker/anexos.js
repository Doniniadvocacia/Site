// Anexos do histórico e do financeiro: guardados cifrados no Cloudflare R2 (binding ARQUIVOS).
import { agora, cifrarBytes, decifrarBytes, tokenAleatorio } from "./seguranca.js";

export const LIMITE_ANEXO = 20 * 1024 * 1024; // 20 MB
const POR_EXTENSAO = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
const MIME_POR_EXTENSAO = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain", zip: "application/zip", odt: "application/vnd.oasis.opendocument.text",
};

export const anexosDisponiveis = (env) => Boolean(env.ARQUIVOS);
export const nomeSeguro = (n) => String(n || "arquivo").replace(/[\\/\x00-\x1f"<>|:*?]/g, "_").trim().slice(0, 150) || "arquivo";
const mimeDe = (nome, informado) => {
  const ext = (nome.match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase();
  return MIME_POR_EXTENSAO[ext] || (/^[\w.+-]+\/[\w.+-]+$/.test(informado || "") ? informado : "application/octet-stream");
};

// Recebe um File de formulário; devolve o id do anexo, null se não houver arquivo, ou lança erro com mensagem amigável.
export async function salvarAnexo(env, arquivo, contexto, usuarioId) {
  if (!arquivo || typeof arquivo === "string" || !arquivo.size) return null;
  if (!anexosDisponiveis(env)) throw new Error("Os anexos ainda não estão ativados (R2 do Cloudflare).");
  if (arquivo.size > LIMITE_ANEXO) throw new Error("O arquivo passa de 20 MB.");
  const nome = nomeSeguro(arquivo.name);
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  return gravar(env, { nome, dados, mime: mimeDe(nome, arquivo.type), contexto, usuarioId });
}

async function gravar(env, { nome, dados, mime, contexto, usuarioId, id = null }) {
  const chave = `${contexto}/${new Date().toISOString().slice(0, 7)}/${tokenAleatorio(18)}`;
  await env.ARQUIVOS.put(chave, await cifrarBytes(env, dados), { httpMetadata: { contentType: "application/octet-stream" } });
  if (id) {
    await env.DB.prepare("UPDATE anexos SET chave = ?, tipo_mime = ?, tamanho = ?, erro = NULL WHERE id = ?").bind(chave, mime, dados.length, id).run();
    return id;
  }
  const r = await env.DB.prepare("INSERT INTO anexos (chave, nome, tipo_mime, tamanho, contexto, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(chave, nome, mime, dados.length, contexto, usuarioId ?? null, agora()).run();
  return r.meta.last_row_id;
}

export async function excluirAnexo(env, id) {
  if (!id) return;
  const a = await env.DB.prepare("SELECT chave FROM anexos WHERE id = ?").bind(id).first();
  if (a?.chave && anexosDisponiveis(env)) await env.ARQUIVOS.delete(a.chave);
  await env.DB.prepare("DELETE FROM anexos WHERE id = ?").bind(id).run();
}

// Download: só para a equipe logada; anexos do financeiro exigem a credencial do financeiro.
export async function servirAnexo(env, sessao, id) {
  const texto = (msg, status) => new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const a = await env.DB.prepare("SELECT * FROM anexos WHERE id = ?").bind(Number(id)).first();
  if (!a) return texto("Anexo não encontrado.", 404);
  if (a.contexto === "financeiro" && !sessao.financeiro) return texto("Acesso restrito ao financeiro.", 403);
  if (!a.chave) return texto("Este anexo ainda não foi copiado do Wix. Use Configurações › Importar do Wix › Copiar anexos.", 409);
  if (!anexosDisponiveis(env)) return texto("Anexos indisponíveis: R2 não configurado.", 503);
  const obj = await env.ARQUIVOS.get(a.chave);
  if (!obj) return texto("Arquivo não encontrado no armazenamento.", 404);
  const dados = await decifrarBytes(env, await obj.arrayBuffer());
  // Tipo do arquivo: sem parâmetros; arquivos do Wix às vezes chegam como octet-stream, então a extensão decide.
  let mime = String(a.tipo_mime || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (mime === "application/octet-stream" || mime === "binary/octet-stream") mime = POR_EXTENSAO[(a.nome || "").toLowerCase().split(".").pop()] || mime;
  const modo = INLINE.has(mime) ? "inline" : "attachment";
  // PDF: o leitor de PDF do Chrome se recusa a abrir documentos com CSP "sandbox" ("Esta página foi bloqueada
  // pelo Chrome", ERR_BLOCKED_BY_CLIENT). PDFs vão sem sandbox (o leitor do navegador é isolado da página);
  // imagens continuam em sandbox; os demais arquivos são sempre baixados, nunca exibidos.
  const csp = mime === "application/pdf" ? "frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
    : modo === "inline" ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
      : "default-src 'none'; frame-ancestors 'none'";
  return new Response(dados, { headers: {
    "Content-Type": mime,
    "Content-Disposition": `${modo}; filename="${nomeSeguro(a.nome).replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": csp,
    "X-Robots-Tag": "noindex, nofollow",
  } });
}

// ---------- Cópia dos anexos do Wix ----------
// Registra (sem baixar) um anexo do Wix; devolve o id. A cópia do arquivo é feita depois, em lotes.
export async function registrarAnexoWix(env, origem, nome, contexto) {
  if (!origem || !String(origem).startsWith("wix:document://")) return null;
  await env.DB.prepare("INSERT INTO anexos (nome, contexto, origem_wix, criado_em) VALUES (?, ?, ?, ?) ON CONFLICT(origem_wix) DO NOTHING")
    .bind(nomeSeguro(nome || origem.split("/").pop()), contexto, origem, agora()).run();
  return (await env.DB.prepare("SELECT id FROM anexos WHERE origem_wix = ?").bind(origem).first())?.id ?? null;
}

const idArquivoWix = (origem) => {
  const partes = String(origem).replace("wix:document://v1/", "").split("/");
  return partes[0] === "ugd" ? partes[1] : partes[0];
};

export async function baixarDoWix(env, origem) {
  const fileId = idArquivoWix(origem);
  const tentativas = [];
  if (env.WIX_API_KEY) {
    try {
      const r = await fetch(`${env.WIX_API_BASE || "https://www.wixapis.com"}/site-media/v1/files/generate-file-download-url`, {
        method: "POST",
        headers: { Authorization: env.WIX_API_KEY, "wix-site-id": env.WIX_SITE_ID || "4ce0a7a8-3fa0-495f-a643-664a08144c36", "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, expirationInMinutes: 10 }),
      });
      if (r.ok) { const u = (await r.json()).downloadUrls?.[0]?.url; if (u) tentativas.push(u); }
    } catch {}
  }
  tentativas.push(`https://docs.wixstatic.com/ugd/${fileId}`, `https://static.wixstatic.com/ugd/${fileId}`);
  for (const url of tentativas) {
    const r = await fetch(url);
    if (r.ok) return { dados: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("Content-Type") };
  }
  throw new Error("não foi possível baixar do Wix");
}

export async function copiarAnexosWix(env, limite = 8) {
  if (!anexosDisponiveis(env)) throw new Error("R2 não configurado.");
  const { results } = await env.DB.prepare("SELECT * FROM anexos WHERE chave IS NULL AND origem_wix IS NOT NULL ORDER BY (erro IS NOT NULL), id LIMIT ?").bind(limite).all();
  let ok = 0, falhas = 0;
  for (const a of results) {
    try {
      const { dados, mime } = await baixarDoWix(env, a.origem_wix);
      if (dados.length > LIMITE_ANEXO * 2) throw new Error("arquivo grande demais");
      await gravar(env, { nome: a.nome, dados, mime: mimeDe(a.nome, (mime || "").split(";")[0]), contexto: a.contexto, id: a.id });
      ok++;
    } catch (e) {
      falhas++;
      await env.DB.prepare("UPDATE anexos SET erro = ? WHERE id = ?").bind(String(e.message).slice(0, 200), a.id).run();
    }
  }
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM anexos WHERE chave IS NULL AND origem_wix IS NOT NULL").first();
  return { ok, falhas, pendentes: pend.n };
}
