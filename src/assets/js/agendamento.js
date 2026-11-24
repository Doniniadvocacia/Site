// Novo agendamento: o campo Tipo mostra só a lista da categoria escolhida (Prazo ou Compromisso).
(function () {
  "use strict";
  document.querySelectorAll("form.form-agendamento").forEach(function (form) {
    var categoria = form.querySelector("select[data-categoria]");
    var tipo = form.querySelector("select[name=tipo]");
    if (!categoria || !tipo) return;
    var listas = {
      Prazo: JSON.parse(tipo.getAttribute("data-tipos-prazo") || "[]"),
      Compromisso: JSON.parse(tipo.getAttribute("data-tipos-compromisso") || "[]"),
    };
    categoria.addEventListener("change", function () {
      var lista = listas[categoria.value] || [];
      var atual = tipo.value;
      tipo.textContent = "";
      var vazio = document.createElement("option");
      vazio.value = ""; vazio.textContent = "Selecione…";
      tipo.appendChild(vazio);
      lista.forEach(function (t) {
        var o = document.createElement("option");
        o.value = t; o.textContent = t;
        if (t === atual) o.selected = true;
        tipo.appendChild(o);
      });
      form.classList.toggle("form-compromisso", categoria.value === "Compromisso");
    });
  });
})();
