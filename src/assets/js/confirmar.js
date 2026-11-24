// Pede confirmação antes de enviar formulários de exclusão (atributo data-confirmar com a pergunta).
(function () {
  "use strict";
  document.querySelectorAll("form[data-confirmar]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!window.confirm(form.getAttribute("data-confirmar"))) e.preventDefault();
    });
  });
})();
