// Sessões: o token aleatório vai só no cookie; o banco guarda apenas o hash dele.
import { agora, sha256, tokenAleatorio } from "./seguranca.js";

export const COOKIE = "__Host-diligo";
const DURACAO = { senha: 10 * 60, completa: 12 * 60 * 60 }; // 10 min para digitar o 2FA; 12 h de sessão

function lerCookie(req) {
  const c = req.headers.get("Cookie") || "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE.replace(/[$]/g, "\\$")}=([^;]+)`));
  return m ? m[1] : null;
}

export function cookieSessao(token, duracao) {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${duracao}`;
}
export const cookieApagar = () => `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;

export async function criarSessao(env, req, usuarioId, etapa) {
  const token = tokenAleatorio(32);
  const t = agora();
  await env.DB.prepare(
    "INSERT INTO sessoes (token_hash, usuario_id, etapa, csrf, criada_em, expira_em, ip, agente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(await sha256(token), usuarioId, etapa, tokenAleatorio(24), t, t + DURACAO[etapa],
    req.headers.get("CF-Connecting-IP") || "", (req.headers.get("User-Agent") || "").slice(0, 200)).run();
  return cookieSessao(token, DURACAO[etapa]);
}

export async function lerSessao(env, req) {
  const token = lerCookie(req);
  if (!token) return null;
  const s = await env.DB.prepare(
    `SELECT s.token_hash, s.etapa, s.csrf, s.expira_em, u.id AS usuario_id, u.nome, u.email, u.perfil,
            u.totp_enc, u.totp_ativo, u.totp_ultimo, u.trocar_senha, u.ativo
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`
  ).bind(await sha256(token)).first();
  if (!s || s.expira_em < agora() || !s.ativo) {
    if (s) await env.DB.prepare("DELETE FROM sessoes WHERE token_hash = ?").bind(s.token_hash).run();
    return null;
  }
  return s;
}

export async function encerrarSessao(env, sessao) {
  if (sessao) await env.DB.prepare("DELETE FROM sessoes WHERE token_hash = ?").bind(sessao.token_hash).run();
}

export async function encerrarTodas(env, usuarioId, excetoHash = "") {
  await env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ? AND token_hash != ?").bind(usuarioId, excetoHash).run();
}

export async function auditar(env, req, usuarioId, acao, detalhe = "") {
  await env.DB.prepare("INSERT INTO auditoria (usuario_id, acao, detalhe, ip, criado_em) VALUES (?, ?, ?, ?, ?)")
    .bind(usuarioId ?? null, acao, String(detalhe).slice(0, 500), req.headers.get("CF-Connecting-IP") || "", agora()).run();
}
