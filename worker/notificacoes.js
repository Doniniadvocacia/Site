// Sino de notificações da barra superior.
// "Pendências" são calculadas na hora (prazos, compromissos, follow-ups, leads, intimações);
// "Notificações" são avisos gravados para cada usuário (prazo atribuído, novas intimações, lead atribuído...).
import { html, pagina, resposta, redirecionar, dataBR } from "./html.js";
import { agora, iguais } from "./seguranca.js";
import { hojeBR } from "./calendario.js";

const LIMITE = 5; // itens exibidos por grupo; o total aparece no título do grupo

// ---------- Gravação ----------
export async function idsPorNome(env, nome) {
  if (!nome) return [];
  const { results } = await env.DB.prepare("SELECT id FROM usuarios WHERE ativo = 1 AND nome = ? AND perfil != 'cliente'").bind(nome).all();
  return results.map((r) => r.id);
}
// Quem acompanha o Financeiro: administradores e usuários com a credencial do financeiro.
export async function idsFinanceiro(env) {
  const { results } = await env.DB.prepare("SELECT id FROM usuarios WHERE ativo = 1 AND (perfil = 'admin' OR acesso_financeiro = 1)").all();
  return results.map((r) => r.id);
}
export async function idsPorPerfil(env, perfis) {
  const { results } = await env.DB.prepare(`SELECT id FROM usuarios WHERE ativo = 1 AND perfil IN (${perfis.map(() => "?").join(",")})`).bind(...perfis).all();
  return results.map((r) => r.id);
}

// Grava a notificação para cada destinatário (sem repetir e sem avisar quem fez a ação).
export async function notificar(env, { destinos, tipo, texto, link = null, autorId = null }) {
  const ids = [...new Set(destinos.filter((d) => d && d !== autorId))];
  if (!ids.length) return 0;
  const t = agora();
  try {
    await env.DB.batch(ids.map((id) => env.DB.prepare("INSERT INTO notificacoes (usuario_id, tipo, texto, link, autor_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, tipo, String(texto).slice(0, 300), link, autorId, t)));
  } catch { return 0; } // notificação nunca impede a ação principal
  return ids.length;
}

// ---------- Leitura ----------
const escopo = (sessao, coluna) => (sessao.perfil === "admin" ? ["1 = 1", []] : [`(COALESCE(${coluna}, '') = '' OR ${coluna} = ?)`, [sessao.nome]]);
const rotProc = (r) => [r.pasta && `Pasta ${r.pasta}`, r.cliente].filter(Boolean).join(" · ");

export async function carregarNotificacoes(env, sessao) {
  const hoje = hojeBR();
  const [ep, ap] = escopo(sessao, "p.responsavel");
  const [et, at] = escopo(sessao, "t.responsavel");
  const [el, al] = escopo(sessao, "l.responsavel");
  const q = (sql, args = []) => env.DB.prepare(sql).bind(...args);
  const consultas = [
    q(`SELECT p.id, p.titulo, p.prazo_fatal, COALESCE(p.prazo_interno, p.prazo_fatal) AS data, pr.pasta, c.nome AS cliente FROM prazos p
        LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN clientes c ON c.id = pr.cliente_id
        WHERE p.situacao = 'aberto' AND COALESCE(p.categoria, 'Prazo') != 'Compromisso' AND COALESCE(p.prazo_interno, p.prazo_fatal) <= ? AND ${ep}
        ORDER BY data, p.prazo_fatal`, [hoje, ...ap]),
    q(`SELECT 'p' AS origem, p.id, p.titulo, COALESCE(p.prazo_interno, p.prazo_fatal) AS data, p.hora, pr.pasta, c.nome AS cliente FROM prazos p
        LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN clientes c ON c.id = pr.cliente_id
        WHERE p.situacao = 'aberto' AND p.categoria = 'Compromisso' AND COALESCE(p.prazo_interno, p.prazo_fatal) <= ? AND ${ep}
       UNION ALL
       SELECT 'a' AS origem, a.id, a.titulo, a.data, a.hora, pr.pasta, c.nome AS cliente FROM agenda a
        LEFT JOIN processos pr ON pr.id = a.processo_id LEFT JOIN clientes c ON c.id = pr.cliente_id
        WHERE a.situacao = 'agendado' AND a.data <= ?
       ORDER BY data, hora`, [hoje, ...ap, hoje]),
    q(`SELECT t.id, t.titulo, t.data, t.lead_id, t.cliente_id, COALESCE(c.nome, l.nome) AS nome FROM crm_tarefas t
        LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN clientes c ON c.id = t.cliente_id
        WHERE t.feito = 0 AND t.data <= ? AND ${et} ORDER BY t.data, t.id`, [hoje, ...at]),
    q(`SELECT l.id, l.nome, l.etapa FROM leads l WHERE l.etapa IN ('Novo contato', 'Reunião agendada', 'Proposta enviada', 'Negociação') AND ${el}
        AND NOT EXISTS (SELECT 1 FROM crm_tarefas t WHERE t.lead_id = l.id AND t.feito = 0) ORDER BY l.criado_em`, al),
    q("SELECT COUNT(*) AS n FROM publicacoes WHERE situacao = 'pendente'"),
    q("SELECT id, tipo, texto, link, lida, criado_em FROM notificacoes WHERE usuario_id = ? ORDER BY lida, criado_em DESC LIMIT 15", [sessao.usuario_id]),
    q("SELECT COUNT(*) AS n FROM notificacoes WHERE usuario_id = ? AND lida = 0", [sessao.usuario_id]),
    q("SELECT chave FROM pendencias_vistas WHERE usuario_id = ? AND dia = ?", [sessao.usuario_id, hoje]),
  ];
  let r;
  try { r = await env.DB.batch(consultas); } catch { return null; }
  const [prazosTodos, compsTodos, fups, leads, intim, notifs, naoLidas, vistas] = r.map((x) => x.results);
  // Prazos e compromissos já abertos pelo sino hoje (ou lidos/limpos) saem da lista até amanhã.
  const vistos = new Set(vistas.map((v) => v.chave));
  const chaveComp = (c) => (c.origem === "p" ? `prazo:${c.id}` : `agenda:${c.id}`);
  const prazos = prazosTodos.filter((p) => !vistos.has(`prazo:${p.id}`));
  const comps = compsTodos.filter((c) => !vistos.has(chaveComp(c)));
  const viaPendencia = (chave, destino) => `/sistema/notificacoes/pendencia?c=${encodeURIComponent(chave)}&ir=${encodeURIComponent(destino)}`;
  const quando = (d) => (d < hoje ? "Atrasado" : "Hoje");
  const grupos = [
    { nome: "Prazos", total: prazos.length, link: "/sistema/agenda?visao=prazos", itens: prazos.slice(0, LIMITE).map((p) => ({
      texto: p.titulo, detalhe: [rotProc(p), `fatal ${dataBR(p.prazo_fatal)}`].filter(Boolean).join(" · "), selo: quando(p.data), link: viaPendencia(`prazo:${p.id}`, `/sistema/prazos/${p.id}`) })) },
    { nome: "Compromissos", total: comps.length, link: "/sistema/agenda?visao=lista", itens: comps.slice(0, LIMITE).map((c) => ({
      texto: c.titulo, detalhe: [rotProc(c), c.hora].filter(Boolean).join(" · "), selo: quando(c.data), link: viaPendencia(chaveComp(c), c.origem === "p" ? `/sistema/prazos/${c.id}` : `/sistema/agenda/${c.id}`) })) },
    { nome: "Follow-ups", total: fups.length, link: "/sistema/crm?visao=followups", itens: fups.slice(0, LIMITE).map((t) => ({
      texto: t.titulo, detalhe: t.nome, selo: quando(t.data), link: t.cliente_id ? `/sistema/clientes/${t.cliente_id}#followups` : `/sistema/crm/leads/${t.lead_id}#followups` })) },
    { nome: "Leads sem próximo passo", total: leads.length, link: "/sistema/crm", itens: leads.slice(0, LIMITE).map((l) => ({
      texto: l.nome, detalhe: `${l.etapa} · agende um follow-up`, link: `/sistema/crm/leads/${l.id}#followups` })) },
    { nome: "Intimações para triagem", total: intim[0].n, link: "/sistema/publicacoes", itens: intim[0].n ? [{
      texto: `${intim[0].n} intimação(ões) aguardando conferência`, link: "/sistema/publicacoes" }] : [] },
  ].filter((g) => g.total);
  const pendencias = grupos.reduce((s, g) => s + g.total, 0);
  const chavesVisiveis = [...prazos.map((p) => `prazo:${p.id}`), ...comps.map(chaveComp)];
  return { grupos, pendencias, notificacoes: notifs, naoLidas: naoLidas[0].n, total: pendencias + naoLidas[0].n, chavesVisiveis };
}

// ---------- Sino (HTML da barra) ----------
const tempo = (s) => {
  const d = Math.max(0, agora() - s);
  if (d < 3600) return `há ${Math.max(1, Math.floor(d / 60))} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  return new Date((s - 3 * 3600) * 1000).toISOString().slice(0, 10).split("-").reverse().join("/");
};
const icoSino = () => html`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>`;

export function sino(sessao) {
  const n = sessao.notif;
  if (!n) return "";
  const contagem = n.total > 99 ? "99+" : String(n.total);
  return html`<details class="menu-notificacoes">
    <summary class="sino" aria-label="${n.total ? `Notificações: ${n.total} pendente(s)` : "Notificações"}" title="Notificações">${icoSino()}${n.total ? html`<span class="sino-contagem">${contagem}</span>` : ""}</summary>
    <div class="painel-notificacoes" role="dialog" aria-label="Notificações e pendências">
      <div class="painel-notificacoes-topo"><strong>Notificações${n.naoLidas ? html` <span class="contagem">${String(n.naoLidas)}</span>` : ""}</strong>
        ${n.notificacoes.length || n.chavesVisiveis.length ? html`<span class="acoes-notificacoes">
          ${n.naoLidas || n.chavesVisiveis.length ? html`<form method="post" action="/sistema/notificacoes/lidas" class="form-linha"><input type="hidden" name="csrf" value="${sessao.csrf}">
            <button type="submit" class="link-botao">Ler todas</button></form>` : ""}
          <form method="post" action="/sistema/notificacoes/limpar" class="form-linha" data-confirmar="Limpar as notificações e as pendências de prazos e compromissos? Os itens que continuarem pendentes voltam a aparecer amanhã.">
            <input type="hidden" name="csrf" value="${sessao.csrf}"><button type="submit" class="link-botao">Limpar</button></form></span>` : ""}</div>
      <div class="painel-notificacoes-corpo">
        ${n.notificacoes.length ? html`<ul class="lista-notificacoes">${n.notificacoes.map((x) => html`<li class="${x.lida ? "" : "nao-lida"}">
          <a href="/sistema/notificacoes/${String(x.id)}"><span class="notif-texto">${x.texto}</span><small>${tempo(x.criado_em)}</small></a></li>`)}</ul>`
          : html`<p class="notif-vazio">Nenhuma notificação.</p>`}
        <p class="painel-notificacoes-secao">Pendências${n.pendencias ? html` <span class="contagem">${String(n.pendencias)}</span>` : ""}</p>
        ${n.grupos.length ? n.grupos.map((g) => html`<section class="grupo-pendencia">
          <h3><a href="${g.link}">${g.nome}</a> <span class="contagem">${String(g.total)}</span></h3>
          <ul>${g.itens.map((i) => html`<li><a href="${i.link}">${i.selo ? html`<span class="${`notif-selo ${i.selo === "Atrasado" ? "atrasado" : "hoje"}`}">${i.selo}</span>` : ""}<span class="notif-texto">${i.texto}</span>${i.detalhe ? html`<small>${i.detalhe}</small>` : ""}</a></li>`)}</ul>
          ${g.total > g.itens.length ? html`<a class="ver-mais" href="${g.link}">Ver todos (${String(g.total)})</a>` : ""}
        </section>`) : html`<p class="notif-vazio">Nenhuma pendência. Tudo em dia!</p>`}
      </div>
      <a class="painel-notificacoes-rodape" href="/sistema/notificacoes">Ver histórico de notificações</a>
    </div>
  </details>`;
}

// ---------- Rotas ----------
const linkSeguro = (v) => (typeof v === "string" && /^\/sistema\/[\w\-/?=&.%#]*$/.test(v) && !v.includes("//") ? v : "/sistema/notificacoes");

export async function notificacoes(req, env, sessao, id) {
  if (id === "pendencia") {
    // Abrir uma pendência de prazo/compromisso pelo sino: some da lista hoje e segue para o item.
    const sp = new URL(req.url).searchParams;
    const chave = String(sp.get("c") || "");
    if (/^(prazo|agenda):\d+$/.test(chave)) {
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO pendencias_vistas (usuario_id, chave, dia) VALUES (?, ?, ?)").bind(sessao.usuario_id, chave, hojeBR()),
        env.DB.prepare("DELETE FROM pendencias_vistas WHERE dia < ?").bind(hojeBR()),
      ]);
    }
    return redirecionar(linkSeguro(sp.get("ir")));
  }
  if ((id === "lidas" || id === "limpar") && req.method === "POST") {
    const f = await req.formData();
    if (iguais(String(f.get("csrf") || ""), sessao.csrf)) {
      await env.DB.prepare(id === "limpar" ? "DELETE FROM notificacoes WHERE usuario_id = ?" : "UPDATE notificacoes SET lida = 1 WHERE usuario_id = ? AND lida = 0").bind(sessao.usuario_id).run();
      // Pendências de prazos e compromissos: saem da lista até amanhã.
      const atuais = await carregarNotificacoes(env, sessao);
      const dia = hojeBR();
      if (atuais?.chavesVisiveis?.length) {
        await env.DB.batch(atuais.chavesVisiveis.map((c) => env.DB.prepare("INSERT OR IGNORE INTO pendencias_vistas (usuario_id, chave, dia) VALUES (?, ?, ?)").bind(sessao.usuario_id, c, dia)));
      }
    }
    const ref = req.headers.get("Referer");
    let volta = "/sistema/notificacoes";
    try { const u = new URL(ref); if (u.origin === new URL(req.url).origin) volta = linkSeguro(u.pathname + u.search); } catch { /* sem referer */ }
    return redirecionar(volta);
  }
  if (id && /^\d+$/.test(id)) {
    const n = await env.DB.prepare("SELECT id, link FROM notificacoes WHERE id = ? AND usuario_id = ?").bind(Number(id), sessao.usuario_id).first();
    if (!n) return redirecionar("/sistema/notificacoes");
    await env.DB.prepare("UPDATE notificacoes SET lida = 1 WHERE id = ?").bind(n.id).run();
    return redirecionar(linkSeguro(n.link));
  }
  const { results } = await env.DB.prepare("SELECT id, tipo, texto, link, lida, criado_em FROM notificacoes WHERE usuario_id = ? ORDER BY criado_em DESC LIMIT 200").bind(sessao.usuario_id).all();
  return resposta(pagina({
    titulo: "Notificações", sessao,
    corpo: html`<div class="titulo-acoes"><h1>Notificações</h1>
        <span class="botoes-titulo">${results.some((r) => !r.lida) ? html`<form method="post" action="/sistema/notificacoes/lidas" class="form-linha"><input type="hidden" name="csrf" value="${sessao.csrf}"><button type="submit" class="botao-secundario">Ler todas</button></form>` : ""}
        ${results.length ? html`<form method="post" action="/sistema/notificacoes/limpar" class="form-linha" data-confirmar="Limpar todas as notificações?"><input type="hidden" name="csrf" value="${sessao.csrf}"><button type="submit" class="botao-secundario">Limpar notificações</button></form>` : ""}</span></div>
      ${results.length ? html`<ul class="lista-notificacoes pagina-notificacoes cartao">${results.map((x) => html`<li class="${x.lida ? "" : "nao-lida"}">
        <a href="/sistema/notificacoes/${String(x.id)}"><span class="notif-texto">${x.texto}</span><small>${tempo(x.criado_em)}</small></a></li>`)}</ul>`
        : html`<p class="vazio">Nenhuma notificação ainda.</p>`}
      <p class="dica">Você é avisado quando alguém cadastra um prazo ou compromisso com você como responsável, quando chegam intimações para triagem
        e quando um potencial cliente ou follow-up é atribuído a você. Administradores também são avisados dos prazos cadastrados pela equipe.</p>`,
  }));
}
