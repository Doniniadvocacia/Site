export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/_redirects");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  eleventyConfig.addCollection("artigos", (api) =>
    api.getFilteredByGlob("src/artigos/*.md").sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addFilter("head", (arr, n) => (arr || []).slice(0, n));

  eleventyConfig.addFilter("dataBR", (d) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
  );

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
