// Primitivas de segurança do Diligo, todas com a Web Crypto API nativa do Cloudflare.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const agora = () => Math.floor(Date.now() / 1000);

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function aleatorio(n = 32) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function tokenAleatorio(n = 32) {
  return b64(aleatorio(n)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(texto) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(texto)));
}

// Comparação em tempo constante, para não vazar informação pelo tempo de resposta.
export function iguais(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = enc.encode(a), y = enc.encode(b);
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] || 0) ^ (y[i] || 0);
  return dif === 0;
}

// ---------- Senhas: PBKDF2-SHA256 com sal aleatório ----------
const ITERACOES = 100000; // máximo aceito pelo runtime do Cloudflare

async function derivar(senha, sal, iteracoes) {
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteracoes }, chave, 256);
}

export async function hashSenha(senha) {
  const sal = aleatorio(16);
  const h = await derivar(senha, sal, ITERACOES);
  return `pbkdf2-sha256$${ITERACOES}$${b64(sal)}$${b64(h)}`;
}

export async function conferirSenha(senha, armazenado) {
  const [alg, it, sal, h] = String(armazenado).split("$");
  if (alg !== "pbkdf2-sha256") return false;
  const calc = await derivar(senha, deB64(sal), Number(it));
  return iguais(b64(calc), h);
}

// Regra mínima: 12 caracteres, com letras e números.
export function validarSenha(senha) {
  if (typeof senha !== "string" || senha.length < 12) return "A senha precisa ter pelo menos 12 caracteres.";
  if (senha.length > 200) return "A senha é longa demais.";
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return "A senha precisa ter letras e números.";
  return null;
}

// ---------- Criptografia de campos: AES-256-GCM ----------
// A chave fica no segredo DATA_KEY (32 bytes em base64), nunca no código nem no banco.
const chaves = new Map();
async function chaveDados(env) {
  if (!env.DATA_KEY) throw new Error("Segredo DATA_KEY não configurado.");
  if (chaves.has(env.DATA_KEY)) return chaves.get(env.DATA_KEY);
  const bruta = deB64(env.DATA_KEY);
  if (bruta.length !== 32) throw new Error("DATA_KEY deve ter 32 bytes em base64.");
  const chave = await crypto.subtle.importKey("raw", bruta, "AES-GCM", false, ["encrypt", "decrypt"]);
  chaves.set(env.DATA_KEY, chave);
  return chave;
}

export async function cifrar(env, texto) {
  if (texto === null || texto === undefined || texto === "") return null;
  const iv = aleatorio(12);
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveDados(env), enc.encode(String(texto)));
  return `v1:${b64(iv)}:${b64(c)}`;
}

export async function decifrar(env, valor) {
  if (!valor) return "";
  const [v, iv, c] = valor.split(":");
  if (v !== "v1") return "";
  const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await chaveDados(env), deB64(c));
  return dec.decode(p);
}

// ---------- 2FA: TOTP (RFC 6238), compatível com Google/Microsoft Authenticator ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function novoSegredoTotp() {
  const bytes = aleatorio(20);
  let bits = "", out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function deBase32(s) {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

async function codigoTotp(segredo, passo) {
  const chave = await crypto.subtle.importKey("raw", deBase32(segredo), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setBigUint64(0, BigInt(passo));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", chave, msg));
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}

// Aceita o código do passo atual e de um passo antes/depois (tolerância de ±30 s).
// Retorna o passo usado, ou 0 se inválido. Passos já usados são recusados.
export async function conferirTotp(segredo, codigo, ultimoUsado = 0) {
  codigo = String(codigo || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(codigo)) return 0;
  const atual = Math.floor(Date.now() / 30000);
  for (const p of [atual - 1, atual, atual + 1]) {
    if (p <= ultimoUsado) continue;
    if (iguais(await codigoTotp(segredo, p), codigo)) return p;
  }
  return 0;
}

export function uriTotp(segredo, email) {
  const emissor = "Diligo - Eduardo Donini Advocacia";
  return `otpauth://totp/${encodeURIComponent(emissor)}:${encodeURIComponent(email)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;
}
