// Novo lançamento: "Tipo de lançamento" mostra só os itens de receita ou de despesa, conforme o tipo marcado.
(function () {
  "use strict";
  var form = document.querySelector("form.form-lancamento");
  if (!form) return;
  var sel = form.querySelector("select[name=categoria]");
  if (!sel) return;
  var listas = {
    receita: JSON.parse(sel.getAttribute("data-categorias-receita") || "[]"),
    despesa: JSON.parse(sel.getAttribute("data-categorias-despesa") || "[]"),
  };
  var original = sel.value;
  function montar() {
    var marcado = form.querySelector("input[name=tipo]:checked");
    var lista = listas[marcado && marcado.value === "despesa" ? "despesa" : "receita"];
    var atual = sel.value;
    sel.textContent = "";
    var vazio = document.createElement("option"); vazio.value = ""; vazio.textContent = "Selecione…"; sel.appendChild(vazio);
    var itens = lista.slice();
    if (original && itens.indexOf(original) < 0 && atual === original) itens.unshift(original); // registro antigo
    itens.forEach(function (t) {
      var o = document.createElement("option"); o.value = t; o.textContent = t;
      if (t === atual) o.selected = true;
      sel.appendChild(o);
    });
  }
  form.querySelectorAll("input[name=tipo]").forEach(function (r) { r.addEventListener("change", montar); });
})();
