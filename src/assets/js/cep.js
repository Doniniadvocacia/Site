// Busca de endereço pelo CEP: ao completar os 8 dígitos, preenche rua, bairro, cidade e estado.
// Campos marcados com data-endereco="cep|rua|bairro|cidade|uf|numero|complemento" dentro do mesmo formulário.
(function () {
  "use strict";
  document.querySelectorAll('input[data-endereco="cep"]').forEach(function (cep) {
    var form = cep.form;
    var campo = function (n) { return form.querySelector('[data-endereco="' + n + '"]'); };
    var aviso = document.createElement("small");
    aviso.className = "aviso-cep";
    aviso.setAttribute("role", "status");
    cep.insertAdjacentElement("afterend", aviso);
    var ultimo = "";
    function buscar() {
      var d = cep.value.replace(/\D/g, "");
      if (d.length !== 8 || d === ultimo) return;
      ultimo = d;
      aviso.textContent = "Buscando endereço…";
      aviso.className = "aviso-cep";
      fetch("/sistema/cep/" + d, { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { aviso.textContent = j.mensagem; aviso.className = "aviso-cep erro-cep"; return; }
          [["rua", j.rua], ["bairro", j.bairro], ["cidade", j.cidade], ["uf", j.uf]].forEach(function (par) {
            var el = campo(par[0]);
            if (el && par[1]) el.value = par[1];
          });
          var compl = campo("complemento");
          if (compl && !compl.value && j.complemento) compl.value = j.complemento;
          aviso.textContent = "Endereço encontrado. Confira e informe o número.";
          var numero = campo("numero");
          if (numero && !numero.value) numero.focus();
        })
        .catch(function () { aviso.textContent = "Não foi possível consultar o CEP. Preencha manualmente."; aviso.className = "aviso-cep erro-cep"; ultimo = ""; });
    }
    cep.addEventListener("input", buscar);
    cep.addEventListener("blur", buscar);
  });
})();
