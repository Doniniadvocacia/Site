// Máscaras de digitação: data-mascara="celular" (XX) XXXXX-XXXX, "telefone" (XX) XXXX-XXXX, "cep" XXXXX-XXX, "cpf" XXX.XXX.XXX-XX.
(function () {
  "use strict";
  var formatos = {
    celular: { max: 11, f: function (d) { return d.length > 7 ? "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7) : d.length > 2 ? "(" + d.slice(0, 2) + ") " + d.slice(2) : d.length ? "(" + d : ""; } },
    telefone: { max: 10, f: function (d) { return d.length > 6 ? "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6) : d.length > 2 ? "(" + d.slice(0, 2) + ") " + d.slice(2) : d.length ? "(" + d : ""; } },
    cep: { max: 8, f: function (d) { return d.length > 5 ? d.slice(0, 5) + "-" + d.slice(5) : d; } },
    cpf: { max: 11, f: function (d) { return d.length > 9 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9) : d.length > 6 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6) : d.length > 3 ? d.slice(0, 3) + "." + d.slice(3) : d; } },
  };
  function aplicar(el) {
    var m = formatos[el.getAttribute("data-mascara")];
    if (!m) return;
    var d = el.value.replace(/\D/g, "").slice(0, m.max);
    el.value = m.f(d);
  }
  document.querySelectorAll("input[data-mascara]").forEach(function (el) {
    aplicar(el);
    el.addEventListener("input", function () { aplicar(el); });
  });
})();
