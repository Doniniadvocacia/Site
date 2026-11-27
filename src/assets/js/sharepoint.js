// Pasta do processo no SharePoint: carrega a lista de arquivos depois que a ficha abre (não atrasa a página).
(function () {
  "use strict";
  document.querySelectorAll("[data-sharepoint]").forEach(function (el) {
    var bloco = el.closest("details");
    var carregar = function () {
      if (el.getAttribute("data-carregado")) return;
      el.setAttribute("data-carregado", "1");
      fetch(el.getAttribute("data-sharepoint"), { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok || r.redirected) throw new Error("sessao");
          return r.text();
        })
        .then(function (t) { el.innerHTML = t; el.setAttribute("data-pronto", "1"); })
        .catch(function () { el.innerHTML = '<p class="erro">Não foi possível carregar a pasta do SharePoint. Recarregue a página.</p>'; el.setAttribute("data-pronto", "1"); });
    };
    if (!bloco || bloco.open) carregar(); else bloco.addEventListener("toggle", function () { if (bloco.open) carregar(); });
  });
})();
