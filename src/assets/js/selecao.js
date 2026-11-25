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
        pagante: rot.querySelector("input[name=pagante]"),
        itens: [], ativo: -1, timer: null, ctrl: null,
      };
      campos[tipo] = c;
    });
    if (!campos.cliente && !campos.processo) return;
    // Campo Pagante: além dos clientes, oferece o próprio escritório (nas despesas).
    var escritorio = form.getAttribute("data-escritorio") || "";
    var ehDespesa = function () { return form.classList.contains("eh-despesa"); };
    var temValor = function (c) { return !!(c.id.value || (c.pagante && c.pagante.value)); };

    function fechar(c) { c.lista.hidden = true; c.lista.textContent = ""; c.itens = []; c.ativo = -1; c.texto.setAttribute("aria-expanded", "false"); }
    function definir(c, id, rotulo, pagante) {
      c.id.value = id || ""; c.texto.value = rotulo || "";
      if (c.pagante) c.pagante.value = id ? "" : (pagante || "");
      c.limpar.hidden = !temValor(c);
      c.rot.classList.toggle("selecionado", temValor(c));
    }
    function escolher(c, item) {
      if (item.escritorio) { definir(c, "", item.titulo, item.titulo); fechar(c); return; }
      definir(c, item.id, item.titulo);
      fechar(c);
      // Processo escolhido preenche o pagante com o cliente só se o pagante estiver vazio (nas despesas, o escritório continua pagante).
      if (c.tipo === "processo" && campos.cliente && item.cliente_id && !temValor(campos.cliente)) {
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
      var opcaoEscritorio = c.tipo === "cliente" && c.pagante && escritorio && ehDespesa()
        && (!termo || escritorio.toLowerCase().indexOf(termo.toLowerCase()) >= 0) ? [{ id: "", titulo: escritorio, detalhe: "Escritório", escritorio: true }] : [];
      if (termo.length < 2 && !(c.tipo === "processo" && cliente)) { if (opcaoEscritorio.length) mostrar(c, opcaoEscritorio, termo); else fechar(c); return; }
      if (c.ctrl) c.ctrl.abort();
      c.ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var url = "/sistema/busca/opcoes?tipo=" + c.tipo + "&q=" + encodeURIComponent(termo) + (cliente ? "&cliente=" + cliente : "");
      fetch(url, { credentials: "same-origin", signal: c.ctrl ? c.ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (document.activeElement === c.texto) mostrar(c, opcaoEscritorio.concat(j.itens || []), termo); })
        .catch(function () {});
    }
    Object.keys(campos).forEach(function (k) {
      var c = campos[k];
      c.rot.classList.toggle("selecionado", temValor(c));
      c.texto.addEventListener("input", function () {
        if (temValor(c)) { c.id.value = ""; if (c.pagante) c.pagante.value = ""; c.limpar.hidden = true; c.rot.classList.remove("selecionado"); }
        clearTimeout(c.timer); c.timer = setTimeout(function () { buscar(c); }, 200);
      });
      // Com algo já escolhido, o texto fica selecionado: digitar substitui (ex.: trocar o escritório por um cliente).
      var selecionarAoSoltar = false;
      c.texto.addEventListener("focus", function () { if (!temValor(c)) buscar(c); else { c.texto.select(); selecionarAoSoltar = true; } });
      c.texto.addEventListener("mouseup", function (e) { if (selecionarAoSoltar) { e.preventDefault(); c.texto.select(); selecionarAoSoltar = false; } });
      c.texto.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement === c.texto) return; fechar(c); if (!temValor(c)) c.texto.value = ""; }, 150); });
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
