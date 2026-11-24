// Diligo — funil de prospecção: arraste os cartões entre as colunas para mudar a etapa.
// O servidor valida tudo de novo; aqui só melhora a experiência.
(function () {
  "use strict";
  var funil = document.querySelector(".funil[data-csrf]");
  if (!funil) return;
  var csrf = funil.getAttribute("data-csrf");
  var aviso = document.getElementById("aviso-crm");
  var arrastando = null, tempo;

  function mostrar(texto, erro) {
    aviso.textContent = texto;
    aviso.className = "aviso-flutuante" + (erro ? " erro-flutuante" : "");
    aviso.hidden = false;
    clearTimeout(tempo);
    tempo = setTimeout(function () { aviso.hidden = true; }, 4000);
  }
  function contar() {
    funil.querySelectorAll(".coluna-funil").forEach(function (col) {
      col.querySelector(".contagem").textContent = col.querySelectorAll(".cartao-lead").length;
    });
  }
  var colunas = function () { return funil.querySelectorAll(".coluna-funil"); };

  funil.addEventListener("dragstart", function (e) {
    var el = e.target.closest(".cartao-lead");
    if (!el) return;
    arrastando = el;
    el.classList.add("arrastando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", el.getAttribute("data-lead"));
  });
  funil.addEventListener("dragend", function () {
    if (arrastando) arrastando.classList.remove("arrastando");
    arrastando = null;
    colunas().forEach(function (c) { c.classList.remove("alvo"); });
  });
  funil.addEventListener("dragover", function (e) {
    var col = e.target.closest(".coluna-funil");
    if (!arrastando || !col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    colunas().forEach(function (c) { c.classList.toggle("alvo", c === col); });
  });
  funil.addEventListener("drop", function (e) {
    var col = e.target.closest(".coluna-funil");
    var el = arrastando;
    if (!el || !col) return;
    e.preventDefault();
    col.classList.remove("alvo");
    var etapa = col.getAttribute("data-etapa");
    if (etapa === el.getAttribute("data-etapa")) return;
    var origem = el.parentNode;
    col.querySelector(".coluna-funil-itens").prepend(el);
    contar();
    fetch("/sistema/crm/leads/" + el.getAttribute("data-lead") + "/etapa", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams({ csrf: csrf, etapa: etapa }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { origem.prepend(el); contar(); mostrar(j.mensagem, true); return; }
      el.setAttribute("data-etapa", etapa);
      var dias = el.querySelector(".cartao-lead-rodape .dica");
      if (dias) dias.textContent = "0 d na etapa";
      mostrar(j.mensagem, false);
    }).catch(function () {
      origem.prepend(el); contar();
      mostrar("Não foi possível salvar. Verifique a conexão e tente de novo.", true);
    });
  });
})();
