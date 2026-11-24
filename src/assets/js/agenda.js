// Diligo — arrastar no calendário: prazos mudam o prazo interno (até o fatal); compromissos vão para qualquer data.
// O servidor valida tudo de novo; aqui só melhora a experiência.
(function () {
  const cal = document.querySelector(".calendario[data-csrf]");
  if (!cal) return;
  const csrf = cal.dataset.csrf;
  const aviso = document.getElementById("aviso-agenda");
  let arrastando = null;
  let tempoAviso;

  function mostrar(texto, erro) {
    aviso.textContent = texto;
    aviso.className = "aviso-flutuante" + (erro ? " erro-flutuante" : "");
    aviso.hidden = false;
    clearTimeout(tempoAviso);
    tempoAviso = setTimeout(() => { aviso.hidden = true; }, 4000);
  }
  const dias = () => cal.querySelectorAll(".dia[data-data]");
  const limpar = () => dias().forEach((d) => d.classList.remove("bloqueado", "alvo", "permitido"));

  cal.addEventListener("dragstart", (e) => {
    const el = e.target.closest(".etiqueta[data-prazo], .etiqueta[data-agenda]");
    if (!el) return;
    arrastando = el;
    el.classList.add("arrastando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", el.dataset.prazo || el.dataset.agenda);
    const fatal = el.dataset.fatal;
    dias().forEach((d) => d.classList.add(d.dataset.data > fatal ? "bloqueado" : "permitido"));
  });

  cal.addEventListener("dragend", () => {
    if (arrastando) arrastando.classList.remove("arrastando");
    arrastando = null;
    limpar();
  });

  cal.addEventListener("dragover", (e) => {
    const dia = e.target.closest(".dia[data-data]");
    if (!arrastando || !dia || dia.dataset.data > arrastando.dataset.fatal) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dias().forEach((d) => d.classList.toggle("alvo", d === dia));
  });

  cal.addEventListener("drop", async (e) => {
    const dia = e.target.closest(".dia[data-data]");
    const el = arrastando;
    if (!el || !dia) return;
    e.preventDefault();
    limpar();
    const data = dia.dataset.data;
    if (data > el.dataset.fatal) { mostrar("Não é possível passar do prazo fatal.", true); return; }
    if (el.closest(".dia") === dia) return;
    const corpo = new URLSearchParams({ csrf, data });
    try {
      const destino = el.dataset.agenda ? `/sistema/agenda/${el.dataset.agenda}/mover` : `/sistema/prazos/${el.dataset.prazo}/mover`;
      const r = await fetch(destino, {
        method: "POST", body: corpo, credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const j = await r.json();
      if (!j.ok) { mostrar(j.mensagem, true); return; }
      dia.querySelector(".dia-itens").prepend(el);
      el.classList.toggle("no-fatal", !!j.noFatal);
      mostrar(j.mensagem, false);
    } catch {
      mostrar("Não foi possível salvar. Verifique a conexão e tente de novo.", true);
    }
  });
})();
