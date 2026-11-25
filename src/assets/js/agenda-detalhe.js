// Agenda: clicar numa etiqueta abre primeiro um pop-up com os dados da pasta e do prazo/compromisso.
// Ctrl/Cmd+clique (ou botão do meio) continua abrindo direto em outra aba. Arrastar continua reagendando.
(function () {
  "use strict";
  var dlg = null;
  function el(tag, cls, texto) { var e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; }
  function criar() {
    dlg = el("dialog", "popup-agenda");
    dlg.setAttribute("aria-labelledby", "popup-agenda-titulo");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); }); // clique fora fecha
    document.body.appendChild(dlg);
  }
  function mostrar(j) {
    dlg.textContent = "";
    var topo = el("div", "popup-agenda-topo");
    var h = el("h2", null, j.titulo); h.id = "popup-agenda-titulo";
    var fechar = el("button", "popup-fechar", "×"); fechar.type = "button"; fechar.setAttribute("aria-label", "Fechar");
    fechar.addEventListener("click", function () { dlg.close(); });
    topo.appendChild(h); topo.appendChild(fechar); dlg.appendChild(topo);
    var corpo = el("div", "popup-agenda-corpo");
    j.blocos.forEach(function (b) {
      var sec = el("section", "popup-bloco");
      sec.appendChild(el("h3", null, b.titulo));
      var dl = el("dl", "ficha");
      b.campos.forEach(function (c) { var d = el("div"); d.appendChild(el("dt", null, c[0])); d.appendChild(el("dd", null, c[1])); dl.appendChild(d); });
      sec.appendChild(dl); corpo.appendChild(sec);
    });
    if (j.descricao) { var sd = el("section", "popup-bloco"); sd.appendChild(el("h3", null, "Descrição")); sd.appendChild(el("p", "pre popup-descricao", j.descricao)); corpo.appendChild(sd); }
    dlg.appendChild(corpo);
    var rodape = el("div", "popup-agenda-rodape");
    if (j.processo) { var ap = el("a", "botao-link botao-secundario", "Abrir processo"); ap.href = j.processo; rodape.appendChild(ap); }
    var ai = el("a", "botao-link", j.comp ? "Abrir compromisso" : "Abrir prazo"); ai.href = j.link; rodape.appendChild(ai);
    dlg.appendChild(rodape);
    if (!dlg.open) dlg.showModal();
    ai.focus();
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a.etiqueta[data-detalhe]");
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!dlg) criar();
    fetch("/sistema/agenda/detalhe?c=" + encodeURIComponent(a.getAttribute("data-detalhe")), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.ok) mostrar(j); else window.location.href = a.href; })
      .catch(function () { window.location.href = a.href; });
  });
})();
