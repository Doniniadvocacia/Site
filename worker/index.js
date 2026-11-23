// Ponto de entrada do Worker: o site público é servido pelos arquivos estáticos;
// tudo em /sistema passa por aqui, com autenticação obrigatória.
import { html, pagina, resposta, redirecionar } from "./html.js";
import { lerSessao } from "./sessao.js";
import { chaveValida } from "./seguranca.js";
import { configurar, entrar, doisFatores, sair, trocarSenha } from "./rotas/acesso.js";
import { usuarios } from "./rotas/usuarios.js";
import { painel, clientes, processos, busca, buscaSugestoes } from "./rotas/dados.js";
import { importar } from "./rotas/importar.js";
import { prazos } from "./rotas/prazos.js";
import { publicacoes } from "./rotas/publicacoes.js";
import { agenda } from "./rotas/agenda.js";
import { oabs, feriados } from "./rotas/configuracoes.js";
import { capturarDjen } from "./djen.js";
import { cadastroCliente, cadastroProcesso } from "./rotas/cadastro.js";
import { adicionarHistorico, excluirHistorico } from "./rotas/historico.js";
import { financeiro } from "./rotas/financeiro.js";
import { servirAnexo } from "./anexos.js";

const EQUIPE = new Set(["admin", "advogado", "colaborador"]);

function origemValida(req) {
  // Navegadores modernos informam se o envio veio do próprio site.
  const site = req.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin" || site === "none";
  const origem = req.headers.get("Origin");
  if (!origem) return true; // navegador antigo: o cookie SameSite=Strict e o token CSRF continuam valendo
  return origem === new URL(req.url).origin;
}

async function status(env) {
  // Diagnóstico da configuração: mostra apenas se cada item existe, nunca o valor.
  let tabelas = false;
  let usuarios = "?";
  try { const r = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(totp_ativo) AS a FROM usuarios").first(); tabelas = true; usuarios = `${r.n} (com 2FA ativo: ${r.a || 0})`; } catch {}
  const ok = (v) => (v ? "sim" : "NÃO");
  const linhas = [
    `Banco D1 ligado: ${ok(env.DB)}`,
    `Tabelas criadas: ${ok(tabelas)}`,
    `Usuários cadastrados: ${usuarios}`,
    `DATA_KEY: ${ok(env.DATA_KEY)}${env.DATA_KEY ? (chaveValida(env.DATA_KEY) ? " (formato válido)" : " (FORMATO INVÁLIDO: precisa ser 32 bytes em base64)") : ""}`,
    `SETUP_TOKEN: ${ok(env.SETUP_TOKEN)}`,
    `WIX_API_KEY: ${ok(env.WIX_API_KEY)}`,
    `R2 (anexos): ${ok(env.ARQUIVOS)}`,
    `Variáveis recebidas pelo sistema: ${Object.keys(env).filter((k) => /^[A-Z_]+$/.test(k)).sort().join(", ") || "nenhuma"}`,
  ];
  return new Response(linhas.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

function configuracoes(sessao) {
  const item = (href, titulo, texto) => html`<a class="cartao-link" href="${href}"><strong>${titulo}</strong><span>${texto}</span></a>`;
  return resposta(pagina({ titulo: "Configurações", sessao, corpo: html`<h1>Configurações</h1><div class="grade-cartoes">
    ${item("/sistema/usuarios", "Usuários", "Contas da equipe, senhas provisórias e 2FA")}
    ${item("/sistema/oabs", "OABs e DJEN", "Inscrições monitoradas e captura de intimações")}
    ${item("/sistema/feriados", "Feriados", "Feriados locais e suspensões de expediente")}
    ${item("/sistema/importar", "Importar do Wix", "Atualizar a cópia dos dados do sistema antigo")}
    ${item("/sistema/status", "Diagnóstico", "Banco, segredos e configuração")}
  </div>` }));
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
  sessao.pendentes = (await env.DB.prepare("SELECT COUNT(*) AS n FROM publicacoes WHERE situacao = 'pendente'").first())?.n || 0;

  if (caminho === "/sistema") return painel(req, env, sessao);
  if (caminho === "/sistema/busca") return busca(req, env, sessao);
  if (caminho === "/sistema/busca/sugestoes") return buscaSugestoes(req, env);
  let m;
  if (caminho === "/sistema/clientes/novo") return cadastroCliente(req, env, sessao, null);
  if ((m = caminho.match(/^\/sistema\/clientes\/(\d+)\/editar$/))) return cadastroCliente(req, env, sessao, m[1]);
  if (caminho === "/sistema/processos/novo") return cadastroProcesso(req, env, sessao, null);
  if ((m = caminho.match(/^\/sistema\/processos\/(\d+)\/editar$/))) return cadastroProcesso(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/processos\/(\d+)\/historico$/)) && metodo === "POST") return adicionarHistorico(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/historico\/(\d+)\/excluir$/)) && metodo === "POST") return excluirHistorico(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/financeiro(?:\/(novo|\d+(?:\/baixar)?))?$/))) return financeiro(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/anexos\/(\d+)$/))) return servirAnexo(env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/clientes(?:\/(\d+))?$/))) return clientes(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/processos(?:\/(\d+))?$/))) return processos(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/prazos(?:\/(novo|\d+(?:\/(?:cumprir|mover))?))?$/))) return prazos(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/publicacoes(?:\/(\d+))?$/))) return publicacoes(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/agenda(?:\/(novo|\d+|dia\/\d{4}-\d{2}-\d{2}))?$/))) return agenda(req, env, sessao, m[1]);

  const admin = sessao.perfil === "admin";
  if ((m = caminho.match(/^\/sistema\/usuarios(?:\/(\d+))?$/)) && admin) return usuarios(req, env, sessao, m[1]);
  if (caminho === "/sistema/importar" && admin) return importar(req, env, sessao);
  if (caminho === "/sistema/status" && admin) return status(env);
  if (caminho === "/sistema/configuracoes" && admin) return configuracoes(sessao);
  if (caminho === "/sistema/oabs" && admin) return oabs(req, env, sessao);
  if (caminho === "/sistema/feriados" && admin) return feriados(req, env, sessao);

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

  // Captura agendada do DJEN (ver "triggers" no wrangler.jsonc)
  async scheduled(evento, env, ctx) {
    if (env.DB) ctx.waitUntil(capturarDjen(env, "agendada"));
  },
};
