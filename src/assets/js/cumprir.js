// Botões rápidos de "Cumprido" (listas, painel, pasta): abrem uma janela para anexar, se quiser, o comprovante de protocolo.
(function () {
  "use strict";
  var dialogo = null;
  function montar() {
    dialogo = document.createElement("dialog");
    dialogo.className = "dialogo-cumprir";
    dialogo.innerHTML = '<form method="post" enctype="multipart/form-data">' +
      '<h2>Marcar como cumprido</h2>' +
      '<p class="dica">Se quiser, anexe o comprovante de protocolo da peça (opcional).</p>' +
      '<label>Comprovante de protocolo <small>(opcional)</small><input type="file" name="comprovante" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"></label>' +
      '<div class="botoes-form"><button type="submit">Marcar como cumprido</button>' +
      '<button type="button" class="botao-secundario" data-fechar>Cancelar</button></div></form>';
    document.body.appendChild(dialogo);
    dialogo.querySelector("[data-fechar]").addEventListener("click", function () { dialogo.close(); });
    dialogo.addEventListener("click", function (e) { if (e.target === dialogo) dialogo.close(); });
  }
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.matches || !/\/cumprir$/.test(form.getAttribute("action") || "") || form.enctype === "multipart/form-data" || form.closest(".dialogo-cumprir")) return;
    if (typeof HTMLDialogElement !== "function") return; // navegador antigo: segue sem anexo
    e.preventDefault();
    if (!dialogo) montar();
    var f = dialogo.querySelector("form");
    f.setAttribute("action", form.getAttribute("action"));
    f.querySelectorAll("input[type=hidden]").forEach(function (i) { i.remove(); });
    form.querySelectorAll("input[type=hidden]").forEach(function (i) { f.insertBefore(i.cloneNode(), f.firstChild); });
    f.querySelector("input[type=file]").value = "";
    dialogo.showModal();
  }, true);
})();
