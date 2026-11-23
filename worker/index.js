// Ponto de entrada do Worker: o site público é servido pelos arquivos estáticos;
// tudo em /sistema passa por aqui, com autenticação obrigatória.
import { html, pagina, resposta, redirecionar } from "./html.js";
import { lerSessao } from "./sessao.js";
import { configurar, entrar, doisFatores, sair, trocarSenha } from "./rotas/acesso.js";
import { usuarios } from "./rotas/usuarios.js";
import { painel, clientes, processos } from "./rotas/dados.js";
import { importar } from "./rotas/importar.js";

const EQUIPE = new Set(["admin", "advogado", "colaborador"]);

function origemValida(req) {
  // Navegadores modernos informam se o envio veio do próprio site.
  const site = req.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin" || site === "none";
  const origem = req.headers.get("Origin");
  if (!origem) return true; // navegador antigo: o cookie SameSite=Strict e o token CSRF continuam valendo
  return origem === new URL(req.url).origin;
}

async function sistema(req, env) {
  const url = new URL(req.url);
  const caminho = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = req.method;
  if (!["GET", "HEAD", "POST"].includes(metodo)) return new Response("Método não permitido", { status: 405 });
  if (metodo === "POST" && !origemValida(req)) return new Response("Origem inválida", { status: 403 });

  const sessao = await lerSessao(env, req);

  // Rotas que não exigem sessão completa
  if (caminho === "/sistema/configurar") return configurar(req, env);
  if (caminho === "/sistema/entrar") return entrar(req, env, sessao);
  if (caminho === "/sistema/2fa") return doisFatores(req, env, sessao);
  if (caminho === "/sistema/sair" && metodo === "POST") return sair(req, env, sessao);

  // Daqui em diante: login completo (senha + 2FA) e perfil da equipe
  if (!sessao) return redirecionar("/sistema/entrar");
  if (sessao.etapa !== "completa") return redirecionar("/sistema/2fa");
  if (!EQUIPE.has(sessao.perfil)) return resposta(pagina({ titulo: "Acesso negado", corpo: html`<h1>Acesso negado</h1>` }), 403);
  if (caminho === "/sistema/conta/senha") return trocarSenha(req, env, sessao);
  if (sessao.trocar_senha) return redirecionar("/sistema/conta/senha");

  if (caminho === "/sistema") return painel(req, env, sessao);
  let m;
  if ((m = caminho.match(/^\/sistema\/clientes(?:\/(\d+))?$/))) return clientes(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/processos(?:\/(\d+))?$/))) return processos(req, env, sessao, m[1]);

  const admin = sessao.perfil === "admin";
  if ((m = caminho.match(/^\/sistema\/usuarios(?:\/(\d+))?$/)) && admin) return usuarios(req, env, sessao, m[1]);
  if (caminho === "/sistema/importar" && admin) return importar(req, env, sessao);

  return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Página não encontrada</h1>` }), 404);
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === "/sistema" || pathname.startsWith("/sistema/")) {
      if (!env.DB) return new Response("Banco de dados não configurado.", { status: 503 });
      try {
        return await sistema(req, env);
      } catch (e) {
        console.error(e);
        return resposta(pagina({ titulo: "Erro", corpo: html`<h1>Algo deu errado</h1><p>Tente novamente em instantes.</p>` }), 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
