// Exporta do Wix, uma única vez, os artigos do blog (em Markdown) e as imagens
// enviadas pelo escritório. Roda no GitHub Actions (workflow "Exportar do Wix")
// ou localmente:  WIX_API_KEY=... node scripts/exportar-wix.mjs
//
// Variáveis de ambiente:
//   WIX_API_KEY  chave de API do Wix (a mesma usada pelo agente de artigos)
//   WIX_SITE_ID  opcional; padrão = site Eduardo Donini Advocacia

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID || "4ce0a7a8-3fa0-495f-a643-664a08144c36";
if (!API_KEY) {
  console.error("Defina WIX_API_KEY.");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR_ARTIGOS = path.join(ROOT, "src/artigos");
const DIR_IMG_ARTIGOS = path.join(ROOT, "src/assets/img/artigos");
const DIR_IMG_SITE = path.join(ROOT, "src/assets/img/wix");
const MEDIA = "https://static.wixstatic.com/media/";

// Imagens enviadas pelo escritório (prefixo 1570ce_). As do banco do Wix ficam de fora.
const IMAGENS_SITE = {
  "1570ce_fa35f443d46d407aa759b0f68b0c2d5b~mv2.png": "logo.png",
  "1570ce_2b3e4d786d114c31872ba700240fea77~mv2.png": "home-imagem-2.png",
  "1570ce_01c1b4027cfd4f4cadf6663c7962cb2d~mv2.png": "sala-de-reunioes.png",
  "1570ce_f23475cdca7044b68db8f6e7326c9c04~mv2.png": "home-ilustracao.png",
  "1570ce_a3f98edb364945dd8bc78d52c1ed33ae~mv2.png": "cliente-matutando.png",
  "1570ce_c85672ce8cbc47b2bc25607adb811a40~mv2.png": "cliente-meu-pudim-boutique.png",
  "1570ce_169b08d07d5a472d909afba4c1d0b528~mv2.png": "cliente-refugio-pedra-branca.png",
  "1570ce_dd49472aee1f4fe889885e7f552d0d57~mv2.png": "cliente-nutri-camila-borella.png",
  "1570ce_eb1b851809ac458cbfcafe90bc15e353~mv2.png": "cliente-belo-destino.png",
};

async function wix(url) {
  const r = await fetch(url, {
    headers: { Authorization: API_KEY, "wix-site-id": SITE_ID },
  });
  if (!r.ok) throw new Error(`${r.status} ${url}\n${await r.text()}`);
  return r.json();
}

async function baixar(id, destino) {
  const r = await fetch(MEDIA + id);
  if (!r.ok) throw new Error(`Falha ao baixar ${id}: ${r.status}`);
  await writeFile(destino, Buffer.from(await r.arrayBuffer()));
}

const ascii = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- Conversão Ricos -> Markdown ----
const imagensDosArtigos = [];

function inline(nodes = []) {
  return nodes.map((n) => {
    if (n.type === "TEXT") {
      let t = n.textData.text;
      const decs = n.textData.decorations || [];
      if (!t.trim()) return t;
      if (decs.some((d) => d.type === "BOLD")) t = `**${t}**`;
      if (decs.some((d) => d.type === "ITALIC")) t = `*${t}*`;
      const link = decs.find((d) => d.type === "LINK");
      if (link?.linkData?.link?.url) t = `[${t}](${link.linkData.link.url})`;
      return t;
    }
    return inline(n.nodes);
  }).join("");
}

function bloco(n, nivel = 0) {
  const pad = "  ".repeat(nivel);
  switch (n.type) {
    case "PARAGRAPH": return inline(n.nodes);
    case "HEADING": return "#".repeat(Math.min(n.headingData?.level || 2, 4)) + " " + inline(n.nodes);
    case "BULLETED_LIST":
      return n.nodes.map((li) => pad + "- " + li.nodes.map((c) => bloco(c, nivel + 1)).join("\n")).join("\n");
    case "ORDERED_LIST":
      return n.nodes.map((li, i) => pad + `${i + 1}. ` + li.nodes.map((c) => bloco(c, nivel + 1)).join("\n")).join("\n");
    case "BLOCKQUOTE": return n.nodes.map((c) => "> " + bloco(c)).join("\n");
    case "DIVIDER": return "---";
    case "IMAGE": {
      const id = n.imageData?.image?.src?.id;
      if (!id) return "";
      const nome = id.replace(/~mv2/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
      imagensDosArtigos.push({ id, nome });
      return `![${n.imageData?.altText || ""}](/assets/img/artigos/${nome})`;
    }
    default:
      console.warn(`  aviso: bloco ${n.type} convertido só como texto`);
      return inline(n.nodes);
  }
}

const yaml = (s) => JSON.stringify(s ?? "");

// ---- Execução ----
await mkdir(DIR_ARTIGOS, { recursive: true });
await mkdir(DIR_IMG_ARTIGOS, { recursive: true });
await mkdir(DIR_IMG_SITE, { recursive: true });

const lista = await wix("https://www.wixapis.com/blog/v3/posts?paging.limit=100");
console.log(`${lista.posts.length} artigos publicados encontrados.`);

const redirects = [];
for (const resumo of lista.posts) {
  const { post } = await wix(
    `https://www.wixapis.com/blog/v3/posts/${resumo.id}?fieldsets=RICH_CONTENT&fieldsets=SEO`
  );
  const slugNovo = ascii(post.slug);
  const data = post.firstPublishedDate.slice(0, 10);
  const corpo = (post.richContent?.nodes || []).map((n) => bloco(n)).filter((s) => s.trim()).join("\n\n");
  const md = [
    "---",
    `title: ${yaml(post.title)}`,
    `date: ${data}`,
    `description: ${yaml(post.excerpt)}`,
    `slugWix: ${yaml(post.slug)}`,
    "---",
    "",
    corpo,
    "",
  ].join("\n");
  await writeFile(path.join(DIR_ARTIGOS, `${data}-${slugNovo}.md`), md);
  redirects.push(`/post/${encodeURI(post.slug)} /artigos/${slugNovo}/ 301`);
  console.log(`  ✓ ${post.title}`);
}

for (const { id, nome } of imagensDosArtigos) await baixar(id, path.join(DIR_IMG_ARTIGOS, nome));
for (const [id, nome] of Object.entries(IMAGENS_SITE)) await baixar(id, path.join(DIR_IMG_SITE, nome));
console.log(`${imagensDosArtigos.length} imagens de artigos e ${Object.keys(IMAGENS_SITE).length} do site baixadas.`);

// Atualiza o bloco de redirecionamentos dos artigos no _redirects
const arqRedirects = path.join(ROOT, "src/_redirects");
const atual = await readFile(arqRedirects, "utf8");
const novo = atual.replace(
  /# BEGIN ARTIGOS[\s\S]*# END ARTIGOS/,
  `# BEGIN ARTIGOS (gerado por scripts/exportar-wix.mjs)\n${redirects.join("\n")}\n# END ARTIGOS`
);
await writeFile(arqRedirects, novo);
console.log("Redirecionamentos dos artigos gravados em src/_redirects.");
