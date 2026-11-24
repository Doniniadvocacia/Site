// Novo lançamento: comportamento conforme Receita/Despesa e a condição de pagamento.
(function () {
  "use strict";
  var form = document.querySelector("form.form-lancamento");
  if (!form) return;
  var sel = form.querySelector("select[name=categoria]");
  var listas = {
    receita: JSON.parse(sel.getAttribute("data-categorias-receita") || "[]"),
    despesa: JSON.parse(sel.getAttribute("data-categorias-despesa") || "[]"),
  };
  var original = sel.value;
  var escritorio = form.getAttribute("data-escritorio") || "";
  var favorecidos = JSON.parse(form.getAttribute("data-favorecidos") || "[]");
  var pagante = form.querySelector("input[name=pagante]");
  var txt = function (seletor, texto) { var el = form.querySelector(seletor); if (el) el.textContent = texto; };
  var tipoAtual = function () { var m = form.querySelector("input[name=tipo]:checked"); return m && m.value === "despesa" ? "despesa" : "receita"; };

  function montarCategorias() {
    var lista = listas[tipoAtual()];
    var atual = sel.value;
    sel.textContent = "";
    var vazio = document.createElement("option"); vazio.value = ""; vazio.textContent = "Selecione…"; sel.appendChild(vazio);
    var itens = lista.slice();
    if (original && itens.indexOf(original) < 0 && atual === original) itens.unshift(original);
    itens.forEach(function (t) { var o = document.createElement("option"); o.value = t; o.textContent = t; if (t === atual) o.selected = true; sel.appendChild(o); });
  }
  function aplicarTipo(inicial) {
    var despesa = tipoAtual() === "despesa";
    form.classList.toggle("eh-despesa", despesa); form.classList.toggle("eh-receita", !despesa);
    txt(".rotulo-conta", despesa ? "Conta de débito" : "Conta de crédito");
    txt(".rotulo-pago", despesa ? "Já pago" : "Já recebido");
    if (!inicial) montarCategorias();
    // Despesa: pagante é o escritório (preenchido automaticamente, pode ser alterado).
    if (pagante && !inicial) {
      if (despesa && !pagante.value) { pagante.value = escritorio; pagante.setAttribute("data-auto", "1"); }
      else if (!despesa && pagante.getAttribute("data-auto") === "1") { pagante.value = ""; pagante.setAttribute("data-auto", "0"); }
    }
  }
  if (pagante) pagante.addEventListener("input", function () { pagante.setAttribute("data-auto", "0"); });
  form.querySelectorAll("input[name=tipo]").forEach(function (r) { r.addEventListener("change", function () { aplicarTipo(false); }); });
  aplicarTipo(true);

  // Favorecido escolhido: preenche os dados bancários cadastrados (se o campo estiver vazio).
  var fav = form.querySelector("select[name=favorecido]");
  var banc = form.querySelector("textarea[name=dados_bancarios]");
  if (fav && banc) fav.addEventListener("change", function () {
    var f = favorecidos.filter(function (x) { return x.nome === fav.value; })[0];
    if (f && f.dados && (!banc.value || banc.getAttribute("data-auto") === "1")) { banc.value = f.dados; banc.setAttribute("data-auto", "1"); }
  });

  // Valor e condição: mostra só os campos que a condição usa.
  var condicao = form.querySelector("select[name=condicao]");
  if (condicao) {
    var textos = {
      "À Vista": ["Valor (R$)", "Vencimento", "", "Um único lançamento."],
      "Parcelado": ["Valor total (R$)", "Vencimento da 1ª parcela", "Nº de parcelas", "O valor total é dividido em parcelas mensais."],
      "Entrada+Parcelado": ["Valor total (R$)", "Vencimento da entrada", "Nº de parcelas (além da entrada)", "A entrada vence na data informada; o restante é dividido em parcelas mensais a partir do mês seguinte."],
      "Recorrente": ["Valor mensal (R$)", "Vencimento do 1º mês", "Nº de meses", "O valor se repete todo mês pelo número de meses informado."],
    };
    var aplicar = function () {
      var c = condicao.value || "À Vista", t = textos[c] || textos["À Vista"];
      form.setAttribute("data-condicao", c);
      txt(".rotulo-valor", t[0]); txt(".rotulo-vencimento", t[1]); txt(".rotulo-parcelas", t[2]); txt(".dica-condicao", t[3]);
      var parcelas = form.querySelector("input[name=parcelas]"), entrada = form.querySelector("input[name=entrada]");
      if (parcelas) parcelas.required = c !== "À Vista";
      if (entrada) entrada.required = c === "Entrada+Parcelado";
    };
    condicao.addEventListener("change", aplicar);
    aplicar();
  }
})();
