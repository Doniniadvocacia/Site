// Menu da conta (nome do usuário): fecha ao clicar fora ou com Esc.
(function () {
  "use strict";
  var menu = document.querySelector(".menu-conta");
  if (!menu) return;
  document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } });
})();

// Sugestões da barra de busca do Diligo: lista os itens enquanto o usuário digita.
(function () {
  "use strict";
  var form = document.querySelector(".busca-menu");
  if (!form) return;
  var campo = form.querySelector('input[name="q"]');
  var lista = document.getElementById("sugestoes-busca");
  if (!campo || !lista) return;

  var temporizador = null, controlador = null, itens = [], ativo = -1, ultimaBusca = "";

  function fechar() {
    lista.hidden = true;
    lista.textContent = "";
    itens = []; ativo = -1;
    campo.setAttribute("aria-expanded", "false");
    campo.removeAttribute("aria-activedescendant");
  }

  function marcar(indice) {
    if (!itens.length) return;
    if (ativo >= 0 && itens[ativo]) itens[ativo].classList.remove("ativo"), itens[ativo].setAttribute("aria-selected", "false");
    ativo = (indice + itens.length) % itens.length;
    var el = itens[ativo];
    el.classList.add("ativo");
    el.setAttribute("aria-selected", "true");
    campo.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  }

  function mostrar(dados, termo) {
    lista.textContent = "";
    itens = []; ativo = -1;
    var grupoAtual = null;
    (dados.itens || []).forEach(function (item, i) {
      if (item.grupo !== grupoAtual) {
        grupoAtual = item.grupo;
        var cab = document.createElement("li");
        cab.className = "sugestoes-grupo";
        cab.setAttribute("role", "presentation");
        cab.textContent = item.grupo;
        lista.appendChild(cab);
      }
      var li = document.createElement("li");
      li.id = "sugestao-" + i;
      li.className = "sugestao";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.dataset.url = item.url;
      var t = document.createElement("span");
      t.className = "sugestao-titulo";
      t.textContent = item.titulo || "";
      li.appendChild(t);
      if (item.detalhe) {
        var d = document.createElement("span");
        d.className = "sugestao-detalhe";
        d.textContent = item.detalhe;
        li.appendChild(d);
      }
      li.addEventListener("mousedown", function (e) { e.preventDefault(); });
      li.addEventListener("click", function () { window.location.href = item.url; });
      li.addEventListener("mousemove", function () { if (itens[ativo] !== li) marcar(itens.indexOf(li)); });
      lista.appendChild(li);
      itens.push(li);
    });
    var rodape = document.createElement("li");
    rodape.className = "sugestoes-todos";
    rodape.setAttribute("role", "presentation");
    var link = document.createElement("a");
    link.href = "/sistema/busca?q=" + encodeURIComponent(termo);
    link.textContent = itens.length ? "Ver todos os resultados para “" + termo + "”" : "Nada encontrado para “" + termo + "”. Buscar mesmo assim";
    link.addEventListener("mousedown", function (e) { e.preventDefault(); });
    rodape.appendChild(link);
    lista.appendChild(rodape);
    lista.hidden = false;
    campo.setAttribute("aria-expanded", "true");
  }

  function buscar() {
    var termo = campo.value.trim();
    if (termo.length < 2) { ultimaBusca = ""; fechar(); return; }
    if (termo === ultimaBusca && !lista.hidden) return;
    ultimaBusca = termo;
    if (controlador) controlador.abort();
    controlador = typeof AbortController === "function" ? new AbortController() : null;
    fetch("/sistema/busca/sugestoes?q=" + encodeURIComponent(termo), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controlador ? controlador.signal : undefined,
    })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (dados) { if (campo.value.trim() === termo && document.activeElement === campo) mostrar(dados, termo); })
      .catch(function () { /* silencioso: o Enter continua levando à página de resultados */ });
  }

  campo.addEventListener("input", function () {
    clearTimeout(temporizador);
    temporizador = setTimeout(buscar, 200);
  });
  campo.addEventListener("focus", function () { if (campo.value.trim().length >= 2) { ultimaBusca = ""; buscar(); } });
  campo.addEventListener("blur", function () { setTimeout(fechar, 120); });
  campo.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { if (!lista.hidden) { e.preventDefault(); marcar(ativo + 1); } }
    else if (e.key === "ArrowUp") { if (!lista.hidden) { e.preventDefault(); marcar(ativo - 1); } }
    else if (e.key === "Escape") { if (!lista.hidden) { e.preventDefault(); fechar(); } }
    else if (e.key === "Enter" && ativo >= 0 && itens[ativo] && !lista.hidden) {
      e.preventDefault();
      window.location.href = itens[ativo].dataset.url;
    }
  });
  document.addEventListener("click", function (e) { if (!form.contains(e.target)) fechar(); });
})();
