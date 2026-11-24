// Relatórios contábeis: botão "Imprimir / salvar PDF" (no diálogo de impressão, escolha "Salvar como PDF").
(function () {
  "use strict";
  document.querySelectorAll("[data-imprimir]").forEach(function (b) { b.addEventListener("click", function () { window.print(); }); });
})();
