// Cálculos judiciais: linhas de parcelas, campos conforme o regime e gerador de parcelas mensais.
(function () {
  "use strict";
  var form = document.getElementById("form-calculo");
  if (!form) return;
  var MARCOS = { civel: "Citação (início dos juros)", civel_selic: "Citação (início da SELIC)", trabalhista: "Ajuizamento da ação", personalizado: "Início dos juros" };
  var EXPLICA = {
    civel: "Até 29/08/2024: índice escolhido + juros de 1% ao mês (art. 406 do CC, redação anterior, c/c art. 161, § 1º, do CTN). Desde 30/08/2024: IPCA + taxa legal (Lei 14.905/2024).",
    civel_selic: "Até a citação: índice escolhido. Da citação a 29/08/2024: SELIC, que já inclui correção e juros (STJ, Corte Especial). Desde 30/08/2024: IPCA + taxa legal.",
    trabalhista: "Antes do ajuizamento: IPCA-E + juros pela TR (art. 39 da Lei 8.177/91). Do ajuizamento a 29/08/2024: SELIC (ADC 58). Desde 30/08/2024: IPCA + taxa legal (TST, SDI-1).",
    personalizado: "Correção e juros escolhidos para todo o período; opcionalmente, IPCA + taxa legal desde 30/08/2024."
  };
  var regime = form.querySelector("[data-regime]");
  var jurosDesde = form.querySelector("[data-juros-desde]");
  function atualizar() {
    var r = regime.value;
    form.querySelectorAll("[data-so]").forEach(function (el) { el.hidden = el.getAttribute("data-so").split(" ").indexOf(r) < 0; });
    form.querySelectorAll("[data-nao]").forEach(function (el) { el.hidden = el.getAttribute("data-nao").split(" ").indexOf(r) >= 0; });
    var marco = form.querySelector("[data-marco]");
    marco.hidden = !(r === "trabalhista" || jurosDesde.value === "marco");
    form.querySelector("[data-rotulo-marco]").textContent = MARCOS[r] || "Marco";
    form.querySelector("[data-explica-regime]").textContent = EXPLICA[r] || "";
  }
  regime.addEventListener("change", atualizar);
  jurosDesde.addEventListener("change", atualizar);
  atualizar();

  function novaLinha(tipo, valores) {
    var modelo = form.querySelector('template[data-modelo="' + tipo + '"]');
    var lista = form.querySelector('[data-lista="' + tipo + '"]');
    var linha = modelo.content.firstElementChild.cloneNode(true);
    if (valores) Object.keys(valores).forEach(function (k) { var c = linha.querySelector('[name="' + k + '"]'); if (c) c.value = valores[k]; });
    lista.appendChild(linha);
    return linha;
  }
  form.addEventListener("click", function (e) {
    var add = e.target.closest("[data-adicionar]");
    if (add) { var l = novaLinha(add.getAttribute("data-adicionar")); var c = l.querySelector("input"); if (c) c.focus(); return; }
    var rem = e.target.closest("[data-remover-linha]");
    if (rem) {
      var tr = rem.closest("tr"), lista = tr.parentNode;
      if (lista.getAttribute("data-lista") === "parcela" && lista.children.length === 1) { tr.querySelectorAll("input").forEach(function (i) { i.value = ""; }); return; }
      tr.remove();
    }
  });

  var gerador = form.querySelector("[data-gerador]");
  form.querySelector("[data-gerar-mensais]").addEventListener("click", function () { gerador.hidden = !gerador.hidden; if (!gerador.hidden) gerador.querySelector("input").focus(); });
  form.querySelector("[data-g-ok]").addEventListener("click", function () {
    var ini = gerador.querySelector("[data-g-inicio]").value, qtd = parseInt(gerador.querySelector("[data-g-qtd]").value, 10);
    var valor = gerador.querySelector("[data-g-valor]").value, desc = gerador.querySelector("[data-g-desc]").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !(qtd > 0) || !valor) { alert("Informe o primeiro vencimento, a quantidade e o valor."); return; }
    var lista = form.querySelector('[data-lista="parcela"]');
    // remove a linha vazia inicial
    Array.prototype.slice.call(lista.children).forEach(function (tr) { var vazio = Array.prototype.every.call(tr.querySelectorAll("input"), function (i) { return !i.value; }); if (vazio) tr.remove(); });
    var p = ini.split("-").map(Number);
    for (var i = 0; i < Math.min(qtd, 300); i++) {
      var t = p[0] * 12 + (p[1] - 1) + i, a = Math.floor(t / 12), m = t % 12 + 1;
      var ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      var d = a + "-" + String(m).padStart(2, "0") + "-" + String(Math.min(p[2], ultimo)).padStart(2, "0");
      novaLinha("parcela", { parcela_data: d, parcela_valor: valor, parcela_descricao: desc ? desc + " " + String(m).padStart(2, "0") + "/" + a : "" });
    }
    gerador.hidden = true;
  });
})();
