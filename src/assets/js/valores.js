// Botão do olho: oculta ou mostra os valores do financeiro. A escolha fica guardada neste navegador.
(function () {
  "use strict";
  var CHAVE = "diligo-ocultar-valores";
  function lerPreferencia() { try { return localStorage.getItem(CHAVE) === "1"; } catch (e) { return false; } }
  function guardar(v) { try { localStorage.setItem(CHAVE, v ? "1" : "0"); } catch (e) { /* armazenamento indisponível */ } }
  function aplicar(ocultar) {
    document.documentElement.classList.toggle("valores-ocultos", ocultar);
    document.querySelectorAll(".valor[data-valor]").forEach(function (el) { el.textContent = ocultar ? "R$ ***" : el.getAttribute("data-valor"); });
    document.querySelectorAll("[data-alternar-valores]").forEach(function (b) {
      var rotulo = ocultar ? "Mostrar valores" : "Ocultar valores";
      b.setAttribute("aria-pressed", ocultar ? "true" : "false");
      b.setAttribute("title", rotulo);
      b.setAttribute("aria-label", rotulo);
    });
  }
  var ocultar = lerPreferencia();
  aplicar(ocultar);
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-alternar-valores]");
    if (!b) return;
    ocultar = !ocultar;
    guardar(ocultar);
    aplicar(ocultar);
  });
})();
