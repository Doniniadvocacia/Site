// Páginas Clientes e Processos em formato de pesquisa: painel de filtros, resultados sob demanda
// e relatório (tela para imprimir/salvar PDF ou planilha CSV) com as colunas escolhidas.
import { html, pagina, resposta, dataBR, moeda } from "../html.js";
import { decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { dataValida } from "./comum.js";
import { celula, num } from "./relatorios.js";
import { NOME_ESCRITORIO } from "./financeiro.js";
import { abasClientes, chips, etiquetasDe } from "./crm.js";
import { obterListas } from "../listas.js";

const normalizar = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digitos = (v) => String(v ?? "").replace(/\D/g, "");
// Cada palavra precisa aparecer; números (3+ dígitos) valem sem pontuação.
function bateTexto(q, ...campos) {
  const palavras = normalizar(q).split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;
  const texto = normalizar(campos.join(" "));
  const nums = campos.map(digitos).filter(Boolean);
  return palavras.every((p) => texto.includes(p) || (digitos(p).length >= 3 && nums.some((n) => n.includes(digitos(p)))));
}
const igual = (a, b) => normalizar(a).trim() === normalizar(b).trim();
const INATIVO_RE = /arquiv|encerr|baixad|finaliz/;
const inativo = (situacao) => INATIVO_RE.test(normalizar(situacao));
const distintos = (lista) => [...new Map(lista.filter((v) => v && String(v).trim()).map((v) => [normalizar(v).trim(), String(v).trim()])).values()]
  .sort((a, b) => a.localeCompare(b, "pt-BR"));
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const cidadeUf = (cidade, uf) => [cidade, uf].filter(Boolean).join(" / ");

// ---------- Definições ----------
const CLIENTES = {
  chave: "clientes", titulo: "Clientes", singular: "cliente", rotuloRel: "Relatório de clientes",
  colunas: [
    { k: "nome", r: "Nome", padrao: true },
    { k: "tipo", r: "Tipo", padrao: true },
    { k: "documento", r: "CPF/CNPJ", sigilo: true },
    { k: "email", r: "E-mail", sigilo: true },
    { k: "telefone", r: "Telefone", sigilo: true },
    { k: "cidade", r: "Cidade / UF", padrao: true },
    { k: "profissao", r: "Profissão" },
    { k: "origem", r: "Origem", padrao: true },
    { k: "etiquetas", r: "Etiquetas" },
    { k: "processos", r: "Processos", padrao: true, num: true },
    { k: "ativos", r: "Processos ativos", num: true },
    { k: "cadastro", r: "Cadastro", data: true },
  ],
  ordens: [["nome", "Nome"], ["cidade", "Cidade"], ["processos", "Mais processos"], ["cadastro", "Cadastro mais recente"]],
  filtros: ["q", "documento", "tipo", "cidade", "uf", "origem", "etiqueta", "procs", "de", "ate"],
};
const PROCESSOS = {
  chave: "processos", titulo: "Processos", singular: "processo", rotuloRel: "Relatório de processos",
  colunas: [
    { k: "pasta", r: "Pasta", padrao: true },
    { k: "numero", r: "Número", padrao: true },
    { k: "cliente", r: "Cliente", padrao: true },
    { k: "parte_contraria", r: "Parte contrária" },
    { k: "tipo_acao", r: "Ação", padrao: true },
    { k: "situacao", r: "Situação", padrao: true },
    { k: "fase", r: "Fase" },
    { k: "instancia", r: "Instância" },
    { k: "comarca", r: "Comarca / UF", padrao: true },
    { k: "vara", r: "Vara / órgão" },
    { k: "advogado_responsavel", r: "Responsável" },
    { k: "valor_causa", r: "Valor da causa", moeda: true },
    { k: "data_distribuicao", r: "Distribuição", data: true },
    { k: "resultado", r: "Resultado" },
  ],
  ordens: [["pasta", "Pasta"], ["cliente", "Cliente"], ["distribuicao", "Distribuição mais recente"], ["valor", "Maior valor da causa"]],
  filtros: ["q", "cliente", "parte", "tipo_acao", "situacao", "status", "fase", "instancia", "comarca", "uf", "responsavel", "resultado", "de", "ate"],
};

function lerFiltros(def, sp) {
  const f = {};
  for (const k of def.filtros) f[k] = (sp.get(k) || "").trim().slice(0, 120);
  f.de = dataValida(f.de) || ""; f.ate = dataValida(f.ate) || "";
  const ativos = def.filtros.some((k) => f[k]);
  const todos = sp.get("todos") === "1";
  const validas = new Set(def.colunas.map((c) => c.k));
  let cols = sp.getAll("col").filter((c) => validas.has(c));
  if (!cols.length) cols = def.colunas.filter((c) => c.padrao).map((c) => c.k);
  const ordem = def.ordens.some(([k]) => k === sp.get("ordem")) ? sp.get("ordem") : def.ordens[0][0];
  const formato = ["relatorio", "csv"].includes(sp.get("formato")) ? sp.get("formato") : "tela";
  return { f, ativos, todos, pesquisar: ativos || todos, cols, ordem, formato };
}

// ---------- Dados ----------
async function dadosClientes(env, p) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.nome, c.tipo, c.cidade, c.estado, c.profissao, c.origem, c.etiquetas, c.data_cadastro,
            c.documento_enc, c.email_enc, c.telefone_enc,
            COUNT(pr.id) AS processos,
            SUM(CASE WHEN pr.id IS NULL THEN 0 WHEN LOWER(COALESCE(pr.situacao, '')) LIKE '%arquiv%' OR LOWER(COALESCE(pr.situacao, '')) LIKE '%encerr%'
                      OR LOWER(COALESCE(pr.situacao, '')) LIKE '%baixad%' OR LOWER(COALESCE(pr.situacao, '')) LIKE '%finaliz%' THEN 0 ELSE 1 END) AS ativos
       FROM clientes c LEFT JOIN processos pr ON pr.cliente_id = c.id GROUP BY c.id`).all();
  const { f } = p;
  let lista = results.filter((c) =>
    bateTexto(f.q, c.nome, c.etiquetas) &&
    (!f.tipo || igual(c.tipo, f.tipo)) &&
    (!f.cidade || normalizar(c.cidade).includes(normalizar(f.cidade))) &&
    (!f.uf || igual(c.estado, f.uf)) &&
    (!f.origem || igual(c.origem, f.origem)) &&
    (!f.etiqueta || etiquetasDe(c.etiquetas).some((e) => igual(e, f.etiqueta))) &&
    (!f.procs || (f.procs === "ativos" ? c.ativos > 0 : f.procs === "sem" ? c.processos === 0 : f.procs === "inativos" ? c.processos > 0 && !c.ativos : true)) &&
    (!f.de || (c.data_cadastro || "") >= f.de) && (!f.ate || (c.data_cadastro && c.data_cadastro.slice(0, 10) <= f.ate)));
  // Campos cifrados: só decifra o que a pesquisa ou o relatório realmente usa.
  const precisa = ["documento", "email", "telefone"].filter((k) => (k === "documento" && f.documento) || p.cols.includes(k));
  if (precisa.length) {
    await Promise.all(lista.map(async (c) => { for (const k of precisa) c[k] = (await decifrar(env, c[`${k}_enc`])) || ""; }));
    if (f.documento) lista = lista.filter((c) => digitos(f.documento) && digitos(c.documento).includes(digitos(f.documento)));
  }
  const ord = {
    nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    cidade: (a, b) => (a.cidade || "~").localeCompare(b.cidade || "~", "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"),
    processos: (a, b) => b.processos - a.processos || a.nome.localeCompare(b.nome, "pt-BR"),
    cadastro: (a, b) => (b.data_cadastro || "").localeCompare(a.data_cadastro || "") || a.nome.localeCompare(b.nome, "pt-BR"),
  }[p.ordem];
  return lista.sort(ord).map((c) => ({ ...c, cidade: cidadeUf(c.cidade, c.estado), cadastro: c.data_cadastro, url: `/sistema/clientes/${c.id}` }));
}

async function dadosProcessos(env, p) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.pasta, p.numero, p.parte_contraria, p.tipo_acao, p.situacao, p.fase, p.instancia, p.comarca, p.uf, p.vara, p.numero_vara,
            p.advogado_responsavel, p.valor_causa, p.data_distribuicao, COALESCE(NULLIF(p.resultado_atual, ''), p.resultado) AS resultado, c.nome AS cliente
       FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id`).all();
  const { f } = p;
  const lista = results.filter((x) =>
    bateTexto(f.q, x.numero, x.pasta, x.cliente, x.parte_contraria) &&
    (!f.cliente || bateTexto(f.cliente, x.cliente)) &&
    (!f.parte || bateTexto(f.parte, x.parte_contraria)) &&
    (!f.tipo_acao || igual(x.tipo_acao, f.tipo_acao)) &&
    (!f.situacao || (f.situacao === "Sem situação" ? !String(x.situacao || "").trim() : igual(x.situacao, f.situacao))) &&
    (!f.status || (f.status === "ativos" ? !inativo(x.situacao) : inativo(x.situacao))) &&
    (!f.fase || igual(x.fase, f.fase)) &&
    (!f.instancia || igual(x.instancia, f.instancia)) &&
    (!f.comarca || normalizar(x.comarca).includes(normalizar(f.comarca))) &&
    (!f.uf || igual(x.uf, f.uf)) &&
    (!f.responsavel || igual(x.advogado_responsavel, f.responsavel)) &&
    (!f.resultado || igual(x.resultado, f.resultado)) &&
    (!f.de || (x.data_distribuicao || "") >= f.de) && (!f.ate || (x.data_distribuicao && x.data_distribuicao.slice(0, 10) <= f.ate)));
  const pasta = (a, b) => (Number(a.pasta) || 1e9) - (Number(b.pasta) || 1e9) || String(a.pasta || "").localeCompare(String(b.pasta || ""));
  const ord = {
    pasta,
    cliente: (a, b) => (a.cliente || "~").localeCompare(b.cliente || "~", "pt-BR") || pasta(a, b),
    distribuicao: (a, b) => (b.data_distribuicao || "").localeCompare(a.data_distribuicao || "") || pasta(a, b),
    valor: (a, b) => (b.valor_causa || 0) - (a.valor_causa || 0) || pasta(a, b),
  }[p.ordem];
  return lista.sort(ord).map((x) => ({ ...x, comarca: cidadeUf(x.comarca, x.uf), vara: [x.numero_vara, x.vara].filter(Boolean).join(" "), url: `/sistema/processos/${x.id}` }));
}

async function opcoesClientes(env) {
  const [ls, { results }] = await Promise.all([
    obterListas(env, ["origem_cliente", "tipo_cadastro"]),
    env.DB.prepare("SELECT tipo, origem, etiquetas FROM clientes").all(),
  ]);
  return {
    tipos: distintos([...(ls.tipo_cadastro || []), ...results.map((r) => r.tipo)]),
    origens: distintos([...(ls.origem_cliente || []), ...results.map((r) => r.origem)]),
    etiquetas: distintos(results.flatMap((r) => etiquetasDe(r.etiquetas))),
  };
}
async function opcoesProcessos(env) {
  const { results } = await env.DB.prepare(
    "SELECT tipo_acao, situacao, fase, instancia, advogado_responsavel, COALESCE(NULLIF(resultado_atual, ''), resultado) AS resultado FROM processos").all();
  const col = (k) => distintos(results.map((r) => r[k]));
  return { tipos: col("tipo_acao"), situacoes: col("situacao"), fases: col("fase"), instancias: col("instancia"), responsaveis: col("advogado_responsavel"), resultados: col("resultado") };
}

// ---------- Apresentação ----------
const opc = (valores, sel, vazio) => html`<option value="">${vazio}</option>${valores.map((v) => {
  const [val, rot] = Array.isArray(v) ? v : [v, v];
  return html`<option value="${val}"${String(val) === String(sel) ? html` selected` : ""}>${rot}</option>`;
})}`;
const campoTexto = (rot, nome, valor, extra = {}) => html`<label class="${extra.largo ? "filtro-largo" : ""}">${rot}<input name="${nome}" value="${valor}"${extra.ph ? html` placeholder="${extra.ph}"` : ""}${extra.foco ? html` autofocus` : ""}></label>`;
const campoSelect = (rot, nome, valores, sel, vazio = "Todos") => html`<label>${rot}<select name="${nome}">${opc(valores, sel, vazio)}</select></label>`;
const campoData = (rot, nome, valor) => html`<label>${rot}<input type="date" name="${nome}" value="${valor}"></label>`;

function painelFiltros(def, p, op) {
  const f = p.f;
  const campos = def === CLIENTES ? html`
      ${campoTexto("Nome ou etiqueta", "q", f.q, { largo: true, ph: "Digite parte do nome", foco: !p.pesquisar })}
      ${campoTexto("CPF/CNPJ", "documento", f.documento, { ph: "Só os números" })}
      ${campoSelect("Tipo", "tipo", op.tipos, f.tipo)}
      ${campoTexto("Cidade", "cidade", f.cidade)}
      ${campoSelect("UF", "uf", UFS, f.uf, "Todas")}
      ${campoSelect("Origem", "origem", op.origens, f.origem, "Todas")}
      ${op.etiquetas.length ? campoSelect("Etiqueta", "etiqueta", op.etiquetas, f.etiqueta, "Todas") : ""}
      ${campoSelect("Processos", "procs", [["ativos", "Com processos ativos"], ["inativos", "Só processos encerrados"], ["sem", "Sem processos"]], f.procs, "Indiferente")}
      ${campoData("Cadastro de", "de", f.de)}${campoData("Cadastro até", "ate", f.ate)}`
    : html`
      ${campoTexto("Número, pasta ou parte", "q", f.q, { largo: true, ph: "Número do processo, pasta ou nome", foco: !p.pesquisar })}
      ${campoTexto("Cliente", "cliente", f.cliente)}
      ${campoTexto("Parte contrária", "parte", f.parte)}
      ${campoSelect("Ação", "tipo_acao", op.tipos, f.tipo_acao, "Todas")}
      ${campoSelect("Status", "status", [["ativos", "Ativos"], ["inativos", "Encerrados / arquivados"]], f.status, "Todos")}
      ${campoSelect("Situação", "situacao", [...op.situacoes, "Sem situação"], f.situacao, "Todas")}
      ${campoSelect("Fase", "fase", op.fases, f.fase, "Todas")}
      ${op.instancias.length ? campoSelect("Instância", "instancia", op.instancias, f.instancia, "Todas") : ""}
      ${campoTexto("Comarca", "comarca", f.comarca)}
      ${campoSelect("UF", "uf", UFS, f.uf, "Todas")}
      ${op.responsaveis.length ? campoSelect("Responsável", "responsavel", op.responsaveis, f.responsavel) : ""}
      ${op.resultados.length ? campoSelect("Resultado", "resultado", op.resultados, f.resultado) : ""}
      ${campoData("Distribuição de", "de", f.de)}${campoData("Distribuição até", "ate", f.ate)}`;
  return html`<form method="get" class="painel-pesquisa" id="form-pesquisa">
    <div class="painel-pesquisa-topo"><h2>Pesquisar ${def.titulo.toLowerCase()}</h2>
      <a class="link-discreto" href="/sistema/${def.chave}?todos=1">Listar todos</a></div>
    <div class="grade-pesquisa">${campos}
      <label>Ordenar por<select name="ordem">${def.ordens.map(([v, r]) => html`<option value="${v}"${v === p.ordem ? html` selected` : ""}>${r}</option>`)}</select></label>
    </div>
    <div class="botoes-pesquisa">
      <button type="submit">Pesquisar</button>
      ${p.pesquisar ? html`<a class="botao-link botao-secundario" href="/sistema/${def.chave}">Limpar</a>` : ""}
    </div>
    <details class="gerar-relatorio">
      <summary>Gerar relatório</summary>
      <p class="dica">O relatório usa os filtros acima${p.pesquisar ? "" : " (sem filtros, inclui todos os registros)"}. Escolha as colunas:</p>
      <div class="colunas-relatorio">${def.colunas.map((c) => html`<label class="opcao-coluna"><input type="checkbox" name="col" value="${c.k}"${p.cols.includes(c.k) ? html` checked` : ""}> ${c.r}${c.sigilo ? html` <small>(dado sigiloso)</small>` : ""}</label>`)}</div>
      <div class="botoes-pesquisa">
        <button type="submit" name="formato" value="relatorio" class="botao-secundario">Ver relatório (imprimir / PDF)</button>
        <button type="submit" name="formato" value="csv" class="botao-secundario">Exportar planilha (Excel)</button>
      </div>
    </details>
  </form>`;
}

function valorCelula(col, linha) {
  const v = linha[col.k];
  if (col.data) return v ? dataBR(String(v).slice(0, 10)) : "";
  if (col.moeda) return v ? moeda(v) : "";
  if (col.num) return String(v ?? 0);
  if (col.k === "etiquetas") return etiquetasDe(v).join(", ");
  return v ?? "";
}

function tabelaResultados(def, p, linhas) {
  if (!linhas.length) return html`<section class="cartao vazio-pesquisa"><p>Nenhum ${def.singular} encontrado com esses filtros.</p></section>`;
  const cols = def.colunas.filter((c) => c.padrao && !c.sigilo);
  return html`<p class="contagem-pesquisa"><strong>${String(linhas.length)}</strong> ${def.singular}(s) encontrado(s).</p>
    <div class="tabela-rolagem"><table class="tabela-pesquisa">
      <thead><tr>${cols.map((c) => html`<th class="${c.num || c.moeda ? "num" : ""}">${c.r}</th>`)}</tr></thead>
      <tbody>${linhas.map((l) => html`<tr>${cols.map((c, i) => {
        const conteudo = i === (def === PROCESSOS ? 1 : 0)
          ? html`<a href="${l.url}">${valorCelula(c, l) || (def === PROCESSOS ? "sem número" : "—")}</a>${def === CLIENTES ? chips(l.etiquetas) : ""}`
          : valorCelula(c, l);
        return html`<td class="${c.num || c.moeda ? "num" : ""}">${conteudo}</td>`;
      })}</tr>`)}</tbody>
    </table></div>`;
}

function descreverFiltros(def, p) {
  const nomes = { q: def === CLIENTES ? "Nome/etiqueta" : "Busca", documento: "CPF/CNPJ", tipo: "Tipo", cidade: "Cidade", uf: "UF", origem: "Origem", etiqueta: "Etiqueta",
    procs: "Processos", cliente: "Cliente", parte: "Parte contrária", tipo_acao: "Ação", situacao: "Situação", status: "Status", fase: "Fase", instancia: "Instância",
    comarca: "Comarca", responsavel: "Responsável", resultado: "Resultado" };
  const rotulos = { procs: { ativos: "com processos ativos", inativos: "só encerrados", sem: "sem processos" }, status: { ativos: "ativos", inativos: "encerrados/arquivados" } };
  const partes = def.filtros.filter((k) => p.f[k] && k !== "de" && k !== "ate").map((k) => `${nomes[k]}: ${rotulos[k]?.[p.f[k]] || p.f[k]}`);
  const periodo = def === CLIENTES ? "Cadastro" : "Distribuição";
  if (p.f.de || p.f.ate) partes.push(`${periodo}: ${p.f.de ? dataBR(p.f.de) : "…"} a ${p.f.ate ? dataBR(p.f.ate) : "…"}`);
  return partes.length ? partes.join(" · ") : "Todos os registros";
}

function csvRelatorio(def, p, linhas, emissor) {
  const cols = def.colunas.filter((c) => p.cols.includes(c.k));
  const L = [[NOME_ESCRITORIO], [def.rotuloRel], [`Filtros: ${descreverFiltros(def, p)}`], [`Emitido em ${dataBR(hojeBR())} por ${emissor} · ${linhas.length} registro(s)`], [],
    cols.map((c) => c.r)];
  for (const l of linhas) L.push(cols.map((c) => (c.moeda ? num(l[c.k]) : valorCelula(c, l))));
  return "﻿" + L.map((r) => r.map(celula).join(";")).join("\r\n") + "\r\n";
}

function telaRelatorio(def, p, linhas, sessao, voltar) {
  const cols = def.colunas.filter((c) => p.cols.includes(c.k));
  const emitido = new Date(Date.now() - 3 * 3600000).toISOString();
  const csvUrl = voltar.replace(/formato=relatorio/, "formato=csv");
  return resposta(pagina({
    titulo: def.rotuloRel, sessao,
    corpo: html`<p class="trilha nao-imprimir"><a href="${voltar.replace(/[?&]formato=relatorio/, "").replace(/\?$/, "") || `/sistema/${def.chave}`}">${def.titulo}</a></p>
      <div class="titulo-acoes nao-imprimir"><h1>${def.rotuloRel}</h1>
        <span class="botoes-titulo"><button type="button" class="botao-secundario" data-imprimir>Imprimir / salvar PDF</button>
        <a class="botao-link" href="${csvUrl}" download>Exportar planilha</a></span></div>
      <article class="relatorio">
        <header class="cabecalho-relatorio">
          <div><p class="marca-relatorio">${NOME_ESCRITORIO}</p><h2>${def.rotuloRel}</h2></div>
          <dl><div><dt>Filtros</dt><dd>${descreverFiltros(def, p)}</dd></div>
            <div><dt>Registros</dt><dd>${String(linhas.length)}</dd></div>
            <div><dt>Emitido</dt><dd>${emitido.slice(0, 10).split("-").reverse().join("/")} às ${emitido.slice(11, 16)} · ${sessao.nome}</dd></div></dl>
        </header>
        ${linhas.length ? html`<table class="tabela-relatorio">
          <thead><tr><th class="num">#</th>${cols.map((c) => html`<th class="${c.num || c.moeda ? "num" : ""}">${c.r}</th>`)}</tr></thead>
          <tbody>${linhas.map((l, i) => html`<tr><td class="num">${String(i + 1)}</td>${cols.map((c) => html`<td class="${c.num || c.moeda ? "num" : ""}">${valorCelula(c, l)}</td>`)}</tr>`)}</tbody>
          ${def === PROCESSOS && p.cols.includes("valor_causa") ? html`<tfoot><tr><td></td>${cols.map((c) => html`<td class="${c.moeda ? "num" : ""}">${c.moeda ? moeda(linhas.reduce((s, l) => s + (l.valor_causa || 0), 0)) : c === cols[0] ? "Total" : ""}</td>`)}</tr></tfoot>` : ""}
        </table>` : html`<p class="vazio">Nenhum registro com esses filtros.</p>`}
        ${cols.some((c) => c.sigilo) ? html`<p class="nota-relatorio">Contém dados pessoais sigilosos. Guarde e compartilhe este relatório com cuidado (LGPD).</p>` : ""}
        <footer class="rodape-relatorio">Relatório gerado pelo Diligo · ${NOME_ESCRITORIO}.</footer>
      </article>
      <script src="/assets/js/relatorio.js" defer></script>`,
  }));
}

async function pesquisa(def, req, env, sessao) {
  const url = new URL(req.url);
  const p = lerFiltros(def, url.searchParams);
  const carregar = def === CLIENTES ? dadosClientes : dadosProcessos;
  const nomeArq = `${def.chave}-${hojeBR()}`;
  if (p.formato === "csv" || p.formato === "relatorio") {
    const linhas = await carregar(env, p);
    const sigilo = def.colunas.some((c) => c.sigilo && p.cols.includes(c.k));
    await auditar(env, req, sessao.usuario_id, p.formato === "csv" ? "relatorio_exportado" : "relatorio_visualizado",
      `${def.chave}: ${linhas.length} registro(s); colunas ${p.cols.join(",")}${sigilo ? " (com dados sigilosos)" : ""}`);
    if (p.formato === "csv") return new Response(csvRelatorio(def, p, linhas, sessao.nome), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nomeArq}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    return telaRelatorio(def, p, linhas, sessao, `${url.pathname}${url.search}`);
  }
  // A tabela da tela nunca mostra dados sigilosos: não decifra nada aqui.
  const pTela = { ...p, cols: p.cols.filter((k) => !def.colunas.find((c) => c.k === k)?.sigilo) };
  const [op, linhas] = await Promise.all([
    def === CLIENTES ? opcoesClientes(env) : opcoesProcessos(env),
    p.pesquisar ? carregar(env, { ...pTela, f: p.f }) : Promise.resolve(null),
  ]);
  const botoes = def === CLIENTES
    ? html`<span class="botoes-titulo"><a class="botao-link botao-secundario" href="/sistema/crm/leads/novo">Novo potencial cliente</a><a class="botao-link" href="/sistema/clientes/novo">Novo cliente</a></span>`
    : html`<a class="botao-link" href="/sistema/processos/novo">Novo processo</a>`;
  return resposta(pagina({
    titulo: def.titulo, sessao,
    corpo: html`
      <div class="titulo-acoes"><h1>${def.titulo}</h1>${botoes}</div>
      ${def === CLIENTES ? abasClientes("clientes") : ""}
      ${painelFiltros(def, p, op)}
      ${linhas ? tabelaResultados(def, p, linhas)
        : html`<section class="cartao vazio-pesquisa"><p>Preencha um ou mais campos e clique em <strong>Pesquisar</strong>, ou use <a href="/sistema/${def.chave}?todos=1">Listar todos</a>.</p></section>`}`,
  }));
}

export const pesquisaClientes = (req, env, sessao) => pesquisa(CLIENTES, req, env, sessao);
export const pesquisaProcessos = (req, env, sessao) => pesquisa(PROCESSOS, req, env, sessao);
