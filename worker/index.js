// Ponto de entrada do Worker: o site público é servido pelos arquivos estáticos;
// tudo em /sistema passa por aqui, com autenticação obrigatória.
import { html, pagina, resposta, redirecionar, definirVersao } from "./html.js";
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
import { capturarDjen, capturaPendente } from "./djen.js";
import { analisarPendentes } from "./ia.js";
import { msConfigurado, vincularPastasAutomaticas } from "./microsoft.js";
import { calculos } from "./rotas/calculos.js";
import { configuracaoMicrosoft, processoSharepoint } from "./rotas/sharepoint.js";
import { atualizarSePreciso } from "./indices.js";
import { cadastroCliente, cadastroProcesso } from "./rotas/cadastro.js";
import { adicionarHistorico, excluirHistorico, editarHistorico } from "./rotas/historico.js";
import { financeiro } from "./rotas/financeiro.js";
import { servirAnexo } from "./anexos.js";
import { editarCadastro } from "./rotas/conta.js";
import { consultarCep } from "./rotas/cep.js";
import { listas } from "./rotas/listas.js";
import { favorecidos } from "./rotas/favorecidos.js";
import { verificacao, vincularPartes } from "./rotas/verificacao.js";
import { opcoesBusca } from "./rotas/opcoes.js";
import { carregarNotificacoes, sino, notificacoes } from "./notificacoes.js";
import { relatorios } from "./rotas/relatorios.js";
import { detalheJson } from "./rotas/prazo-visualizar.js";
import { configAsaas, conciliacao, cobrancaLancamento } from "./rotas/asaas.js";
import { receberAviso, sincronizar, asaasConfigurado } from "./asaas.js";
import { crm, cadastroLead, fichaLead, acaoLead, novaInteracao, editarInteracao, excluirInteracao, novaTarefa, concluirTarefa } from "./rotas/crm.js";

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
    `ASAAS_API_KEY: ${ok(env.ASAAS_API_KEY)}`,
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
    ${item("/sistema/listas", "Listas", "Incluir e excluir opções dos campos de seleção")}
    ${item("/sistema/favorecidos", "Favorecidos", "Quem recebe pagamentos e repasses do escritório")}
    ${item("/sistema/asaas", "Asaas", "Cobranças, baixa automática de pagamentos e conciliação")}
    ${item("/sistema/microsoft", "Microsoft 365", "SharePoint: pastas dos processos e cópia dos anexos")}
    ${item("/sistema/verificacao", "Verificação de cadastros", "Pessoas duplicadas, clientes sem processo e processos sem cliente")}
    ${item("/sistema/importar", "Importar do Wix", "Atualizar a cópia dos dados do sistema antigo")}
    ${item("/sistema/status", "Diagnóstico", "Banco, segredos e configuração")}
  </div>` }));
}

async function sistema(req, env, ctx) {
  const url = new URL(req.url);
  const caminho = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = req.method;
  if (!["GET", "HEAD", "POST"].includes(metodo)) return new Response("Método não permitido", { status: 405 });
  // Avisos do Asaas (webhook): sem sessão, autenticados pelo token do cabeçalho asaas-access-token.
  if (caminho === "/sistema/asaas/aviso" && metodo === "POST") return receberAviso(req, env);
  if (metodo === "POST" && !origemValida(req)) return new Response("Origem inválida", { status: 403 });

  const sessao = await lerSessao(env, req);
  let m0;

  // Rotas que não exigem sessão completa
  if (caminho === "/sistema/configurar") return configurar(req, env);
  if (caminho === "/sistema/entrar") return entrar(req, env, sessao);
  if (caminho === "/sistema/2fa") return doisFatores(req, env, sessao);
  if (caminho === "/sistema/sair" && metodo === "POST") return sair(req, env, sessao);

  // Volta do login da Microsoft: o navegador não envia o cookie de sessão (SameSite=Strict) numa navegação vinda de outro site.
  // Uma página intermediária do próprio Diligo repete o endereço; essa segunda navegação já é do mesmo site e leva o cookie.
  if (!sessao && caminho === "/sistema/microsoft/retorno" && !url.searchParams.has("r")) {
    const destino = `${caminho}?${url.searchParams.toString()}&r=1`;
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${destino.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"><title>Concluindo a conexão…</title><p>Concluindo a conexão com a Microsoft…</p>`,
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" } });
  }

  // Daqui em diante: login completo (senha + 2FA) e perfil da equipe
  if (!sessao) return redirecionar("/sistema/entrar");
  if (sessao.etapa !== "completa") return redirecionar("/sistema/2fa");
  if (!EQUIPE.has(sessao.perfil)) return resposta(pagina({ titulo: "Acesso negado", corpo: html`<h1>Acesso negado</h1>` }), 403);
  if (caminho === "/sistema/conta/senha") return trocarSenha(req, env, sessao);
  if (sessao.trocar_senha) return redirecionar("/sistema/conta/senha");
  if (caminho === "/sistema/conta/cadastro") return editarCadastro(req, env, sessao);
  if ((m0 = caminho.match(/^\/sistema\/cep\/(\d{5}-?\d{3})$/))) return consultarCep(env, m0[1]);
  sessao.pendentes = (await env.DB.prepare("SELECT COUNT(*) AS n FROM publicacoes WHERE situacao = 'pendente'").first())?.n || 0;
  if ((m0 = caminho.match(/^\/sistema\/notificacoes(?:\/(lidas|limpar|pendencia|\d+))?$/))) return notificacoes(req, env, sessao, m0[1]);
  // Sino de notificações: só nas páginas (GET), não nas consultas de apoio.
  if (metodo === "GET" && !/^\/sistema\/(busca\/|anexos\/|cep\/)/.test(caminho)) {
    if (ctx && (await capturaPendente(env))) ctx.waitUntil(capturarDjen(env, "acesso").then(() => analisarPendentes(env)).catch((e) => console.error(e)));
    sessao.notif = await carregarNotificacoes(env, sessao);
    sessao.sino = sino(sessao);
  }

  if (caminho === "/sistema") return painel(req, env, sessao);
  if (caminho === "/sistema/busca") return busca(req, env, sessao);
  if (caminho === "/sistema/busca/sugestoes") return buscaSugestoes(req, env);
  if (caminho === "/sistema/busca/opcoes") return opcoesBusca(req, env);
  // Favorecidos: administradores e quem tem acesso ao Financeiro.
  if (caminho === "/sistema/favorecidos") return sessao.perfil === "admin" || sessao.financeiro ? favorecidos(req, env, sessao)
    : resposta(pagina({ titulo: "Acesso restrito", sessao, corpo: html`<h1>Acesso restrito</h1>` }), 403);
  let m;
  if (caminho === "/sistema/clientes/novo") return cadastroCliente(req, env, sessao, null);
  if ((m = caminho.match(/^\/sistema\/clientes\/(\d+)\/editar$/))) return cadastroCliente(req, env, sessao, m[1]);
  if (caminho === "/sistema/processos/novo") return cadastroProcesso(req, env, sessao, null);
  if ((m = caminho.match(/^\/sistema\/processos\/(\d+)\/editar$/))) return cadastroProcesso(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/processos\/(\d+)\/historico$/)) && metodo === "POST") return adicionarHistorico(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/historico\/(\d+)$/))) return editarHistorico(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/historico\/(\d+)\/excluir$/)) && metodo === "POST") return excluirHistorico(req, env, sessao, m[1]);
  const semFin = () => resposta(pagina({ titulo: "Acesso restrito", sessao, corpo: html`<h1>Acesso restrito</h1>` }), 403);
  if (caminho === "/sistema/financeiro/conciliacao") return sessao.financeiro ? conciliacao(req, env, sessao) : semFin();
  if ((m = caminho.match(/^\/sistema\/financeiro\/(\d+)\/cobranca(?:\/(cancelar))?$/)) && metodo === "POST") return sessao.financeiro ? cobrancaLancamento(req, env, sessao, m[1], m[2] || "gerar") : semFin();
  if (caminho === "/sistema/financeiro/relatorios") return sessao.financeiro ? relatorios(req, env, sessao)
    : resposta(pagina({ titulo: "Acesso restrito", sessao, corpo: html`<h1>Acesso restrito</h1>` }), 403);
  if ((m = caminho.match(/^\/sistema\/financeiro(?:\/(novo|\d+(?:\/(?:baixar|estornar))?))?$/))) return financeiro(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/anexos\/(\d+)$/))) return servirAnexo(env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/clientes(?:\/(\d+))?$/))) return clientes(req, env, sessao, m[1]);
  // CRM (toda a equipe)
  if (caminho === "/sistema/crm") return crm(req, env, sessao);
  if (caminho === "/sistema/crm/leads/novo") return cadastroLead(req, env, sessao, null);
  if ((m = caminho.match(/^\/sistema\/crm\/leads\/(\d+)$/))) return fichaLead(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/crm\/leads\/(\d+)\/editar$/))) return cadastroLead(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/crm\/leads\/(\d+)\/(etapa|converter|perder|reabrir|excluir)$/)) && metodo === "POST") return acaoLead(req, env, sessao, m[1], m[2]);
  if (caminho === "/sistema/crm/interacoes" && metodo === "POST") return novaInteracao(req, env, sessao);
  if ((m = caminho.match(/^\/sistema\/crm\/interacoes\/(\d+)\/excluir$/)) && metodo === "POST") return excluirInteracao(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/crm\/interacoes\/(\d+)$/))) return editarInteracao(req, env, sessao, m[1]);
  if (caminho === "/sistema/crm/tarefas" && metodo === "POST") return novaTarefa(req, env, sessao);
  if ((m = caminho.match(/^\/sistema\/crm\/tarefas\/(\d+)\/concluir$/)) && metodo === "POST") return concluirTarefa(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/processos(?:\/(\d+))?$/))) return processos(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/prazos(?:\/(novo|\d+(?:\/(?:cumprir|mover|reagendar|cancelar))?))?$/))) return prazos(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/microsoft(?:\/(retorno|conectar))?$/))) return configuracaoMicrosoft(req, env, sessao, m[1]);
  if ((m = caminho.match(/^\/sistema\/processos\/(\d+)\/sharepoint\/(lista|vincular|enviar)$/))) return processoSharepoint(req, env, sessao, m[1], m[2]);
  if ((m = caminho.match(/^\/sistema\/calculos(?:\/(novo|indices|\d+))?(?:\/(editar|excluir))?$/))) return calculos(req, env, sessao, m[1], m[2]);
  if (caminho === "/sistema/publicacoes/analisar") return publicacoes(req, env, sessao, null, ctx, "analisar");
  if ((m = caminho.match(/^\/sistema\/publicacoes\/(\d+)\/(analisar|aprovar|excluir)$/))) return publicacoes(req, env, sessao, m[1], ctx, m[2]);
  if ((m = caminho.match(/^\/sistema\/publicacoes(?:\/(\d+))?$/))) return publicacoes(req, env, sessao, m[1], ctx);
  if (caminho === "/sistema/agenda/detalhe") return detalheJson(req, env);
  if ((m = caminho.match(/^\/sistema\/agenda(?:\/(novo|\d+(?:\/mover)?|dia\/\d{4}-\d{2}-\d{2}))?$/))) return agenda(req, env, sessao, m[1]);

  const admin = sessao.perfil === "admin";
  // Configurações e tudo o que fica dentro delas: somente administradores.
  if (!admin && /^\/sistema\/(configuracoes|usuarios|importar|status|oabs|feriados|listas|asaas|microsoft|verificacao)(\/|$)/.test(caminho)) {
    return resposta(pagina({ titulo: "Acesso restrito", sessao, corpo: html`<h1>Acesso restrito</h1><p>Esta área é exclusiva para administradores.</p>` }), 403);
  }
  if ((m = caminho.match(/^\/sistema\/usuarios(?:\/(\d+))?$/)) && admin) return usuarios(req, env, sessao, m[1]);
  if (caminho === "/sistema/importar" && admin) return importar(req, env, sessao);
  if (caminho === "/sistema/status" && admin) return status(env);
  if (caminho === "/sistema/configuracoes" && admin) return configuracoes(sessao);
  if (caminho === "/sistema/oabs" && admin) return oabs(req, env, sessao);
  if (caminho === "/sistema/feriados" && admin) return feriados(req, env, sessao);
  if (caminho === "/sistema/listas" && admin) return listas(req, env, sessao);
  if (caminho === "/sistema/asaas" && admin) return configAsaas(req, env, sessao);
  if (caminho === "/sistema/verificacao" && admin) return verificacao(req, env, sessao);

  return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Página não encontrada</h1>` }), 404);
}

export default {
  async fetch(req, env, ctx) {
    definirVersao(env.VERSAO?.id);
    const { pathname } = new URL(req.url);
    if (pathname === "/sistema" || pathname.startsWith("/sistema/")) {
      if (!env.DB) return new Response("Banco de dados não configurado.", { status: 503 });
      try {
        return await sistema(req, env, ctx);
      } catch (e) {
        console.error(e);
        return resposta(pagina({ titulo: "Erro", corpo: html`<h1>Algo deu errado</h1><p>Tente novamente em instantes.</p>` }), 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  // Captura agendada do DJEN (ver "triggers" no wrangler.jsonc)
  async scheduled(evento, env, ctx) {
    if (env.DB) ctx.waitUntil(capturarDjen(env, "agendada").then(() => analisarPendentes(env)).catch((e) => console.error(e)));
    if (env.DB && msConfigurado(env)) ctx.waitUntil(vincularPastasAutomaticas(env, { limite: 30 }).catch((e) => console.error(e)));
    if (env.DB) ctx.waitUntil(atualizarSePreciso(env).catch((e) => console.error("Índices:", e.message)));
    // Partes contrárias novas (vindas da importação do Wix) ligadas ao cadastro de pessoas.
    if (env.DB) ctx.waitUntil(vincularPartes(env).catch((e) => console.error("Partes:", e.message)));
    // Limpeza: sessões vencidas (o banco guarda só o hash do token, mas não há motivo para mantê-las).
    if (env.DB) ctx.waitUntil(env.DB.prepare("DELETE FROM sessoes WHERE expira_em < ?").bind(Math.floor(Date.now() / 1000)).run().catch((e) => console.error("Sessões:", e.message)));
    if (env.DB && asaasConfigurado(env)) ctx.waitUntil(sincronizar(env).catch((e) => console.error("Asaas:", e.message)));
  },
};
