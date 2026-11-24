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
        <a href="/sistema/publicacoes">Intimações${pend ? html` <span class="selo-menu">${String(pend)}</span>` : ""}</a>
        <a href="/sistema/agenda">Agenda</a>
        ${sessao.financeiro ? html`<a href="/sistema/financeiro">Financeiro</a>` : ""}
        ${sessao.perfil === "admin" ? html`<a href="/sistema/configuracoes">Configurações</a>` : ""}
        <form class="busca-menu" method="get" action="/sistema/busca" role="search">
          <input name="q" placeholder="Parte, nº do processo ou pasta" aria-label="Buscar por nome da parte, número do processo ou pasta" required
            autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugestoes-busca">
          <button type="submit" aria-label="Buscar" title="Buscar">⌕</button>
          <ul id="sugestoes-busca" class="sugestoes" role="listbox" aria-label="Sugestões de busca" hidden></ul>
        </form>
        <details class="menu-conta">
          <summary class="menu-usuario" aria-label="Menu da conta de ${sessao.nome}" title="${sessao.nome}"><span class="menu-usuario-nome">${sessao.nome.split(" ").slice(0, 2).join(" ")}</span><span class="seta-conta" aria-hidden="true"></span></summary>
          <div class="menu-conta-lista" role="menu">
            <a href="/sistema/conta/senha" role="menuitem">Alterar senha</a>
            <a href="/sistema/conta/cadastro" role="menuitem">Editar cadastro</a>
            <form method="post" action="/sistema/sair" class="form-sair">
              <input type="hidden" name="csrf" value="${sessao.csrf}">
              <button type="submit" role="menuitem">Sair</button>
            </form>
          </div>
        </details>
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
  ${sessao ? html`<script src="/assets/js/busca.js" defer></script>` : ""}
  ${sessao?.financeiro ? html`<script src="/assets/js/valores.js" defer></script>` : ""}
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

// Converte o HTML que vem do DJEN/PJe/eproc (e do Wix) em texto simples, preservando quebras de linha.
// O resultado continua sendo escapado na hora de exibir: nenhuma marcação de origem externa chega à página.
const ENTIDADES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordm: "º", ordf: "ª", sect: "§", deg: "°", ndash: "–", mdash: "—",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", middot: "·", bull: "•",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", Agrave: "À", acirc: "â", ecirc: "ê", ocirc: "ô", Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô", atilde: "ã", otilde: "õ",
  Atilde: "Ã", Otilde: "Õ", ccedil: "ç", Ccedil: "Ç", uuml: "ü", Uuml: "Ü",
};
export function textoDeHtml(v) {
  let s = String(v ?? "");
  if (!/<\/?[a-z!][^>]*>/i.test(s) && !/&[a-z#0-9]+;/i.test(s)) return s.trim();
  s = s.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|tr|table|h[1-6]|li|center|ul|ol|blockquote|section|article)\s*>/gi, "\n")
    .replace(/<(p|div|table|h[1-6]|center|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m);
  return s.split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").replace(/\s+([:;,.])(\s|$)/g, "$1$2").trim())
    .join("\n").replace(/\n{2,}/g, "\n").trim();
}
