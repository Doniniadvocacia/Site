export default {
  layout: "artigo.njk",
  eleventyComputed: {
    // 2026-08-05-titulo-do-artigo.md -> /artigos/titulo-do-artigo/
    permalink: (data) => `/artigos/${data.page.fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "")}/`,
  },
};
