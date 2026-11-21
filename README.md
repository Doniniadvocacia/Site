# Site — Eduardo Donini Advocacia

Site institucional de www.doniniadvocacia.com.br, publicado no Cloudflare Pages.

## Como funciona
- `src/` — páginas (Nunjucks/HTML), artigos em Markdown (`src/artigos/`), CSS e imagens (`src/assets/`).
- `src/_redirects` — redirecionamentos 301 das URLs antigas do Wix.
- Gerador: [Eleventy](https://www.11ty.dev/). `npm run build` gera o site em `_site/`.
- Cada commit no ramo `main` é publicado automaticamente pelo Cloudflare Pages; outros ramos geram uma prévia.

## Configuração no Cloudflare (Workers & Pages)
- Comando de build: `npm run build`
- Comando de implantação: `npx wrangler deploy` (padrão)
- A pasta publicada (`_site`), a página 404 e o tratamento de barras finais estão em `wrangler.jsonc`.

## Migração do Wix
- `_migracao/` — backup do conteúdo das páginas, DNS atual e inventário de imagens.
- Workflow **Exportar do Wix** (aba Actions → Run workflow): exporta os artigos do blog e as imagens próprias, e abre um pull request. Precisa do segredo `WIX_API_KEY` no repositório.

## Publicar um artigo
Criar `src/artigos/AAAA-MM-DD-titulo.md` com o cabeçalho:

```
---
title: "Título do artigo"
date: 2026-11-20
description: "Resumo de uma ou duas frases."
---
```
