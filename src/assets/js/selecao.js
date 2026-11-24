// Campos de busca de cliente e processo: digite nome da parte, nº do processo ou pasta e escolha na lista.
// Com um cliente escolhido, o campo de processo lista só os processos dele (inclusive sem digitar nada).
(function () {
  "use strict";
  document.querySelectorAll("form").forEach(function (form) {
    var campos = {};
    form.querySelectorAll("[data-busca]").forEach(function (rot) {
      var tipo = rot.getAttribute("data-busca");
      var c = {
        rot: rot, tipo: tipo,
        texto: rot.querySelector(".busca-texto"),
        id: rot.querySelector("input[type=hidden]"),
        lista: rot.querySelector(".busca-opcoes"),
        limpar: rot.querySelector(".busca-limpar"),
        itens: [], ativo: -1, timer: null, ctrl: null,
      };
      campos[tipo] = c;
    });
    if (!campos.cliente && !campos.processo) return;

    function fechar(c) { c.lista.hidden = true; c.lista.textContent = ""; c.itens = []; c.ativo = -1; c.texto.setAttribute("aria-expanded", "false"); }
    function definir(c, id, rotulo) {
      c.id.value = id || ""; c.texto.value = rotulo || ""; c.limpar.hidden = !id;
      c.rot.classList.toggle("selecionado", !!id);
    }
    function escolher(c, item) {
      definir(c, item.id, item.titulo);
      fechar(c);
      if (c.tipo === "processo" && campos.cliente && item.cliente_id && String(campos.cliente.id.value) !== String(item.cliente_id)) {
        definir(campos.cliente, item.cliente_id, item.cliente_nome);
      }
      if (c.tipo === "cliente" && campos.processo && campos.processo.id.value) {
        // Cliente trocado: o processo escolhido só fica se for desse cliente.
        if (String(campos.processo.id.getAttribute("data-cliente") || "") !== String(item.id)) definir(campos.processo, "", "");
      }
      if (c.tipo === "processo") c.id.setAttribute("data-cliente", item.cliente_id || "");
    }
    function marcar(c, i) {
      if (!c.itens.length) return;
      if (c.ativo >= 0) c.itens[c.ativo].el.classList.remove("ativo");
      c.ativo = (i + c.itens.length) % c.itens.length;
      c.itens[c.ativo].el.classList.add("ativo");
      c.itens[c.ativo].el.scrollIntoView({ block: "nearest" });
    }
    function mostrar(c, itens, termo) {
      c.lista.textContent = ""; c.itens = []; c.ativo = -1;
      if (!itens.length) {
        var vazio = document.createElement("li"); vazio.className = "sugestoes-todos";
        vazio.textContent = termo ? "Nada encontrado." : "Nenhum processo vinculado a este cliente.";
        c.lista.appendChild(vazio);
      }
      itens.forEach(function (item) {
        var li = document.createElement("li"); li.className = "sugestao"; li.setAttribute("role", "option");
        var t = document.createElement("span"); t.className = "sugestao-titulo"; t.textContent = item.titulo; li.appendChild(t);
        if (item.detalhe) { var d = document.createElement("span"); d.className = "sugestao-detalhe"; d.textContent = item.detalhe; li.appendChild(d); }
        li.addEventListener("mousedown", function (e) { e.preventDefault(); });
        li.addEventListener("click", function () { escolher(c, item); });
        c.lista.appendChild(li);
        c.itens.push({ el: li, item: item });
      });
      c.lista.hidden = false; c.texto.setAttribute("aria-expanded", "true");
    }
    function buscar(c) {
      var termo = c.texto.value.trim();
      var cliente = c.tipo === "processo" && campos.cliente ? campos.cliente.id.value : "";
      if (termo.length < 2 && !(c.tipo === "processo" && cliente)) { fechar(c); return; }
      if (c.ctrl) c.ctrl.abort();
      c.ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var url = "/sistema/busca/opcoes?tipo=" + c.tipo + "&q=" + encodeURIComponent(termo) + (cliente ? "&cliente=" + cliente : "");
      fetch(url, { credentials: "same-origin", signal: c.ctrl ? c.ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (document.activeElement === c.texto) mostrar(c, j.itens || [], termo); })
        .catch(function () {});
    }
    Object.keys(campos).forEach(function (k) {
      var c = campos[k];
      c.rot.classList.toggle("selecionado", !!c.id.value);
      c.texto.addEventListener("input", function () {
        if (c.id.value) { c.id.value = ""; c.limpar.hidden = true; c.rot.classList.remove("selecionado"); }
        clearTimeout(c.timer); c.timer = setTimeout(function () { buscar(c); }, 200);
      });
      c.texto.addEventListener("focus", function () { if (!c.id.value) buscar(c); });
      c.texto.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement === c.texto) return; fechar(c); if (!c.id.value) c.texto.value = ""; }, 150); });
      c.texto.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); if (c.lista.hidden) buscar(c); else marcar(c, c.ativo + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); marcar(c, c.ativo - 1); }
        else if (e.key === "Enter" && !c.lista.hidden) { e.preventDefault(); if (c.ativo >= 0) escolher(c, c.itens[c.ativo].item); }
        else if (e.key === "Escape") fechar(c);
      });
      c.limpar.addEventListener("click", function () {
        definir(c, "", "");
        if (c.tipo === "cliente" && campos.processo) definir(campos.processo, "", "");
        c.texto.focus();
      });
    });
  });
})();
