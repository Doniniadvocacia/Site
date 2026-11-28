// Partes contrárias no cadastro do processo: busca no cadastro de pessoas, com nome livre permitido
// (sem escolher na lista, o nome digitado vira um cadastro novo ao salvar). Também inclui/remove outras partes.
(function () {
  "use strict";
  function ligar(rot) {
    if (rot.getAttribute("data-ligado")) return;
    rot.setAttribute("data-ligado", "1");
    var texto = rot.querySelector(".parte-texto"), id = rot.querySelector(".parte-id"), lista = rot.querySelector(".parte-opcoes");
    var itens = [], ativo = -1, timer = null, ctrl = null;
    function fechar() { lista.hidden = true; lista.textContent = ""; itens = []; ativo = -1; texto.setAttribute("aria-expanded", "false"); }
    function escolher(it) { texto.value = it.titulo; id.value = it.id; rot.classList.add("selecionado"); fechar(); }
    function marcar(i) {
      if (!itens.length) return;
      if (ativo >= 0) itens[ativo].el.classList.remove("ativo");
      ativo = (i + itens.length) % itens.length; itens[ativo].el.classList.add("ativo");
    }
    function mostrar(lst, termo) {
      lista.textContent = ""; itens = []; ativo = -1;
      lst.forEach(function (it) {
        var li = document.createElement("li"); li.className = "sugestao"; li.setAttribute("role", "option");
        var t = document.createElement("span"); t.className = "sugestao-titulo"; t.textContent = it.titulo; li.appendChild(t);
        if (it.detalhe) { var d = document.createElement("span"); d.className = "sugestao-detalhe"; d.textContent = it.detalhe; li.appendChild(d); }
        li.addEventListener("mousedown", function (e) { e.preventDefault(); });
        li.addEventListener("click", function () { escolher(it); });
        lista.appendChild(li); itens.push({ el: li, it: it });
      });
      var exato = lst.some(function (it) { return it.titulo.toLowerCase() === termo.toLowerCase(); });
      if (!exato) {
        var novo = document.createElement("li"); novo.className = "sugestoes-todos";
        novo.textContent = "“" + termo + "” não está cadastrado: será criado ao salvar.";
        lista.appendChild(novo);
      }
      lista.hidden = false; texto.setAttribute("aria-expanded", "true");
    }
    function buscar() {
      var termo = texto.value.trim();
      if (termo.length < 2) { fechar(); return; }
      if (ctrl) ctrl.abort();
      ctrl = typeof AbortController === "function" ? new AbortController() : null;
      fetch("/sistema/busca/opcoes?tipo=pessoa&q=" + encodeURIComponent(termo), { credentials: "same-origin", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (document.activeElement === texto) mostrar(j.itens || [], termo); })
        .catch(function () {});
    }
    texto.addEventListener("input", function () {
      id.value = ""; rot.classList.remove("selecionado");
      clearTimeout(timer); timer = setTimeout(buscar, 200);
    });
    texto.addEventListener("blur", function () { setTimeout(fechar, 150); });
    texto.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (lista.hidden) buscar(); else marcar(ativo + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); marcar(ativo - 1); }
      else if (e.key === "Enter" && !lista.hidden) { if (ativo >= 0) { e.preventDefault(); escolher(itens[ativo].it); } else fechar(); }
      else if (e.key === "Escape") fechar();
    });
    if (id.value) rot.classList.add("selecionado");
  }
  document.querySelectorAll(".campo-parte").forEach(ligar);
  document.querySelectorAll("[data-outras-partes]").forEach(function (bloco) {
    var listaPartes = bloco.querySelector(".lista-partes"), modelo = bloco.querySelector("template[data-modelo-parte]");
    bloco.querySelector("[data-adicionar-parte]").addEventListener("click", function () {
      var novo = modelo.content.firstElementChild.cloneNode(true);
      listaPartes.appendChild(novo);
      var rot = novo.querySelector(".campo-parte"); ligar(rot); rot.querySelector(".parte-texto").focus();
    });
    listaPartes.addEventListener("click", function (e) {
      var b = e.target.closest("[data-remover-parte]");
      if (b) b.closest(".linha-parte").remove();
    });
  });
})();
