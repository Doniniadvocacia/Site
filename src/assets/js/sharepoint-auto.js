// Microsoft 365: segue criando as pastas dos processos em lotes até acabar.
(function () {
  "use strict";
  var f = document.querySelector("form[data-auto-continuar]");
  if (f) setTimeout(function () { f.submit(); }, 400);
})();
