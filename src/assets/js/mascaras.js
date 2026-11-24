// Máscaras de digitação: celular (XX) XXXXX-XXXX, telefone (XX) XXXX-XXXX, fone (um ou outro), cep XXXXX-XXX, cpf, documento (CPF ou CNPJ).
(function () {
  "use strict";
  var formatos = {
    celular: { max: 11, f: function (d) { return d.length > 7 ? "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7) : d.length > 2 ? "(" + d.slice(0, 2) + ") " + d.slice(2) : d.length ? "(" + d : ""; } },
    telefone: { max: 10, f: function (d) { return d.length > 6 ? "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6) : d.length > 2 ? "(" + d.slice(0, 2) + ") " + d.slice(2) : d.length ? "(" + d : ""; } },
    cep: { max: 8, f: function (d) { return d.length > 5 ? d.slice(0, 5) + "-" + d.slice(5) : d; } },
    cpf: { max: 11, f: function (d) { return d.length > 9 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9) : d.length > 6 ? d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6) : d.length > 3 ? d.slice(0, 3) + "." + d.slice(3) : d; } },
  };
  // Telefone que pode ser fixo ou celular, e documento que pode ser CPF ou CNPJ.
  formatos.fone = { max: 11, f: function (d) { return d.length > 10 ? formatos.celular.f(d) : formatos.telefone.f(d); } };
  formatos.documento = { max: 14, f: function (d) {
    if (d.length <= 11) return formatos.cpf.f(d);
    return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + (d.length > 12 ? "-" + d.slice(12) : "");
  } };
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
