// Pede confirmação antes de enviar formulários de exclusão (atributo data-confirmar com a pergunta).
(function () {
  "use strict";
  document.querySelectorAll("form[data-confirmar]").forEach(function (form) {
    if (form.getAttribute("data-confirmar-ligado")) return; // o script pode estar na página duas vezes
    form.setAttribute("data-confirmar-ligado", "1");
    form.addEventListener("submit", function (e) {
      if (!window.confirm(form.getAttribute("data-confirmar"))) e.preventDefault();
    });
  });
})();
