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
    // Prazo padrão do tipo (Configurações › Listas): preenche "Prazo (dias)" e a contagem.
    var padroes = JSON.parse(tipo.getAttribute("data-padroes") || "{}");
    var dias = form.querySelector("input[name=dias]");
    var contagem = form.querySelector("select[name=contagem]");
    var dica = form.querySelector("[data-dica-padrao]");
    if (dias) dias.addEventListener("input", function () { dias.setAttribute("data-auto", "0"); });
    function aplicarPadrao(inicial) {
      var pad = categoria.value === "Prazo" ? padroes[tipo.value] : null;
      if (dica) dica.textContent = pad ? "Padrão: " + pad.dias + " dias " + (pad.contagem === "corridos" ? "corridos" : "úteis") : "";
      if (!dias || inicial) return;
      if (!pad) { if (dias.getAttribute("data-auto") === "1") { dias.value = ""; dias.setAttribute("data-auto", "0"); } return; }
      if (!dias.value || dias.getAttribute("data-auto") === "1") {
        dias.value = pad.dias;
        dias.setAttribute("data-auto", "1");
        if (contagem) contagem.value = pad.contagem;
      }
    }
    tipo.addEventListener("change", function () { aplicarPadrao(false); });
    aplicarPadrao(true);
    if (dias && !dias.value) { aplicarPadrao(false); }
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
      aplicarPadrao(false);
    });
  });
})();
