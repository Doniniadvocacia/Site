// Montagem das páginas do sistema. Todo valor dinâmico passa por h() antes de entrar no HTML.

export function h(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Marca um trecho como HTML já seguro (montado aqui, com valores escapados).
export const seguro = (s) => ({ __html: s });
const render = (v) => (v && v.__html !== undefined ? v.__html : h(v));
export function html(partes, ...valores) {
  let out = partes[0];
  valores.forEach((v, i) => {
    out += Array.isArray(v) ? v.map(render).join("") : render(v);
    out += partes[i + 1];
  });
  return seguro(out);
}

const CABECALHOS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Robots-Tag": "noindex, nofollow",
};

export function resposta(corpo, status = 200, extras = {}) {
  const headers = new Headers(CABECALHOS);
  for (const [k, v] of Object.entries(extras)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(render(corpo), { status, headers });
}

export function redirecionar(destino, extras = {}) {
  const headers = new Headers({ Location: destino, "Cache-Control": "no-store" });
  for (const [k, v] of Object.entries(extras)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(null, { status: 303, headers });
}

// Página com menu (usuário autenticado) ou sem menu (login, 2FA).
export function pagina({ titulo, corpo, sessao = null, aviso = null, erro = null }) {
  const pend = sessao?.pendentes || 0;
  const menu = sessao
    ? html`<nav class="menu">
        <a href="/sistema/">Painel</a>
        <a href="/sistema/clientes">Clientes</a>
        <a href="/sistema/processos">Processos</a>
        <a href="/sistema/prazos">Prazos</a>
        <a href="/sistema/publicacoes">Intimações${pend ? html` <span class="selo-menu">${String(pend)}</span>` : ""}</a>
        <a href="/sistema/agenda">Agenda</a>
        ${sessao.perfil === "admin" ? html`<a href="/sistema/configuracoes">Configurações</a>` : ""}
        <form class="busca-menu" method="get" action="/sistema/busca" role="search">
          <input name="q" placeholder="Buscar processo, parte, pasta..." aria-label="Buscar processo, parte ou pasta" required>
          <button type="submit" aria-label="Buscar" title="Buscar">⌕</button>
        </form>
        <a href="/sistema/conta/senha" class="menu-usuario">${sessao.nome}</a>
        <form method="post" action="/sistema/sair" class="form-sair">
          <input type="hidden" name="csrf" value="${sessao.csrf}">
          <button type="submit">Sair</button>
        </form>
      </nav>`
    : "";
  return html`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${titulo} · Diligo</title>
  <link rel="stylesheet" href="/assets/css/sistema.css">
  <link rel="icon" href="/favicon.ico" sizes="any">
</head>
<body class="${sessao ? "logado" : "publico"}">
  <header class="topo-sistema">
    <a class="marca-sistema" href="/sistema/">Diligo<span>Eduardo Donini Advocacia</span></a>
    ${menu}
  </header>
  <main class="conteudo">
    ${aviso ? html`<p class="aviso">${aviso}</p>` : ""}
    ${erro ? html`<p class="erro" role="alert">${erro}</p>` : ""}
    ${corpo}
  </main>
</body>
</html>`;
}

export const campoCsrf = (sessao) => html`<input type="hidden" name="csrf" value="${sessao.csrf}">`;

export function dataBR(v) {
  if (!v) return "";
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export function moeda(v) {
  if (v === null || v === undefined || v === "") return "";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
