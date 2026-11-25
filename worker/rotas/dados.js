// Painel, clientes e processos (consulta, fichas e busca). Cadastro e edição ficam em cadastro.js.
import { html, pagina, resposta, dataBR, moeda, textoDeHtml } from "../html.js";
import { decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR, somarDias } from "../calendario.js";
import { urgencia, rotuloProcesso } from "./comum.js";
import { icone } from "../icones.js";
import { campoCsrf } from "../html.js";
import { cartaoHistorico, mensagemDaUrl } from "./historico.js";
import { cartaoFinanceiro } from "./financeiro.js";
import { fichaProcesso } from "./ficha-processo.js";
import { abasClientes, chips, etiquetasDe, blocoRelacionamento, followupsPainel, mensagem as mensagemCrm } from "./crm.js";
import { obterListas } from "../listas.js";

const naoEncontrado = (sessao) => resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Registro não encontrado</h1>` }), 404);
const campo = (rotulo, valor) => (valor ? html`<div><dt>${rotulo}</dt><dd>${valor}</dd></div>` : "");
// Cartão com ficha; some quando não há nenhum campo preenchido.
const secao = (titulo, campos, extra = "") => {
  const cheios = campos.filter((c) => c !== "");
  if (!cheios.length && !extra) return "";
  return html`<section class="cartao">${titulo ? html`<h2>${titulo}</h2>` : ""}${cheios.length ? html`<dl class="ficha">${cheios}</dl>` : ""}${extra}</section>`;
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const INATIVO = "(LOWER(COALESCE(situacao, '')) LIKE '%arquiv%' OR LOWER(COALESCE(situacao, '')) LIKE '%encerr%' OR LOWER(COALESCE(situacao, '')) LIKE '%baixad%' OR LOWER(COALESCE(situacao, '')) LIKE '%finaliz%')";
const ORDEM_FASES = ["Aguarda Citação", "Conhecimento", "Instrução", "Sentencial", "Recursal", "Cumprimento de Sentença", "Trânsito em Julgado"];
const ORDEM_RESULTADOS = ["Procedente", "Parcialmente Procedente", "Improcedente", "Extinto s/ Resolução de Mérito"];

function ordenar(lista, ordem) {
  const pos = (v) => { const i = ordem.findIndex((o) => o.toLowerCase() === String(v).toLowerCase()); return i < 0 ? 99 : i; };
  return [...lista].sort((a, b) => pos(a.rotulo) - pos(b.rotulo) || b.n - a.n);
}
const barras = (titulo, legenda, itens) => {
  const max = Math.max(1, ...itens.map((i) => i.n));
  return html`<section class="painel-cartao distribuicao">
    <div class="painel-cartao-topo"><h2>${titulo}</h2><span>${legenda}</span></div>
    ${itens.length ? html`<ul>${itens.map((i) => html`<li><span class="rotulo-barra">${i.rotulo}</span>
      <span class="trilho"><span class="barra b${String(Math.round((i.n / max) * 20) * 5)}"></span></span><strong>${String(i.n)}</strong></li>`)}</ul>`
      : html`<p class="vazio">Sem dados.</p>`}
  </section>`;
};

export async function painel(req, env, sessao) {
  const hoje = hojeBR();
  const [proc, prz, ativosFase, resultados, audiencias, { results: proximos }] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN ${INATIVO} THEN 0 ELSE 1 END) AS ativos FROM processos`).first(),
    env.DB.prepare(`SELECT SUM(CASE WHEN COALESCE(prazo_interno, prazo_fatal) < ?1 THEN 1 ELSE 0 END) AS atrasados,
        SUM(CASE WHEN COALESCE(prazo_interno, prazo_fatal) = ?1 THEN 1 ELSE 0 END) AS hoje,
        SUM(CASE WHEN COALESCE(prazo_interno, prazo_fatal) > ?1 THEN 1 ELSE 0 END) AS futuros FROM prazos WHERE situacao = 'aberto' AND COALESCE(categoria, 'Prazo') != 'Compromisso'`).bind(hoje).first(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(fase), ''), 'Sem fase') AS rotulo, COUNT(*) AS n FROM processos WHERE NOT ${INATIVO} GROUP BY 1`).all(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(COALESCE(NULLIF(resultado_atual, ''), resultado)), ''), '') AS rotulo, COUNT(*) AS n FROM processos GROUP BY 1`).all(),
    env.DB.prepare(`SELECT titulo, data, hora FROM (
        SELECT titulo, data, hora FROM agenda WHERE situacao = 'agendado' AND data >= ?1 AND LOWER(COALESCE(tipo, '') || titulo) LIKE '%audi%'
        UNION ALL SELECT titulo, data_audiencia AS data, hora_audiencia AS hora FROM prazos WHERE situacao = 'aberto' AND data_audiencia >= ?1)
      ORDER BY data, hora LIMIT 3`).bind(hoje).all(),
    env.DB.prepare(`SELECT p.id, p.titulo, p.tipo, p.categoria, p.descricao, p.prazo_fatal, COALESCE(p.prazo_interno, p.prazo_fatal) AS interno,
        pr.id AS processo_id, pr.pasta, pr.numero, c.nome AS cliente
      FROM prazos p LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN clientes c ON c.id = pr.cliente_id
      WHERE p.situacao = 'aberto' ORDER BY interno, p.prazo_fatal LIMIT 25`).all(),
  ]);
  const fup = await followupsPainel(env);
  const total = proc.total || 0, ativos = proc.ativos || 0;
  const pct = total ? Math.round((ativos / total) * 100) : 0;
  const [, mes, dia] = hoje.split("-");
  const fases = ordenar(ativosFase.results, ORDEM_FASES);
  const res = ordenar(resultados.results.filter((r) => r.rotulo), ORDEM_RESULTADOS);
  const status = (d) => (d < hoje ? html`<span class="atraso">PRAZO EM ATRASO</span>` : d === hoje ? html`<span class="atraso">HOJE</span>` : html`<span>${dataBR(d)}</span>`);
  const resumoTexto = (t) => { const x = textoDeHtml(t).replace(/\s+/g, " ").trim(); return x.length > 140 ? x.slice(0, 140) + "…" : x; };

  return resposta(pagina({
    titulo: "Visão geral", sessao,
    corpo: html`
      <div class="titulo-painel">
        <div><h1>Visão Geral</h1><p>Acompanhe a visão geral dos processos e clientes aqui!</p></div>
        <div class="botoes-pilula"><a href="/sistema/prazos/novo">Novo Agendamento</a></div>
      </div>

      <div class="destaques">
        <div class="cartao-data"><span class="cartao-data-mes">${MESES[Number(mes) - 1]}</span><span class="cartao-data-dia">${String(Number(dia))}</span></div>
        <a class="destaque verde" href="/sistema/processos">
          <span class="marca-agua">${icone.balanca(130)}</span>
          <h2>Processos</h2>
          <div class="destaque-numero"><strong>${String(ativos)}</strong><span>Ativos</span></div>
          <div class="destaque-rodape"><span>Percentual de Ativos</span><span>${String(pct)}%</span></div>
        </a>
        <a class="destaque azul" href="/sistema/agenda?visao=prazos">
          <span class="marca-agua">${icone.agenda(130)}</span>
          <h2>Prazos</h2>
          <dl class="destaque-lista">
            <dt>${String(prz.atrasados || 0)}</dt><dd>Atrasados</dd>
            <dt>${String(prz.hoje || 0)}</dt><dd>Hoje</dd>
            <dt>${String(prz.futuros || 0)}</dt><dd>Futuros</dd>
          </dl>
        </a>
        <a class="destaque vinho" href="/sistema/agenda">
          <span class="marca-agua">${icone.alerta(130)}</span>
          <h2>Proximas Audiências</h2>
          ${audiencias.results.length ? html`<ul class="destaque-audiencias">${audiencias.results.map((a) => html`<li><strong>${dataBR(a.data)}${a.hora ? ` ${a.hora}` : ""}</strong> ${a.titulo}</li>`)}</ul>`
            : html`<p class="destaque-vazio">Sem Audiências Agendadas</p>`}
        </a>
      </div>

      <div class="distribuicoes">
        ${barras("Distribuição por fase", "Processos Ativos", fases)}
        ${barras("Distribuição por resultado", "Resultado da Ação", res)}
      </div>

      ${fup.itens.length ? html`<details class="compromissos followups-painel" open>
        <summary><h2>Follow-ups de clientes</h2></summary>
        <ul class="lista-tarefas">${fup.itens.map((t) => html`<li class="${t.data < fup.hoje ? "atrasado" : t.data === fup.hoje ? "hoje" : ""}">
          <span class="tarefa-data">${t.data < fup.hoje ? "Atrasado · " : t.data === fup.hoje ? "Hoje · " : ""}${dataBR(t.data)}</span>
          <span class="tarefa-titulo">${t.titulo}</span>
          <a href="${t.cliente_id ? `/sistema/clientes/${t.cliente_id}#followups` : `/sistema/crm/leads/${t.lead_id}#followups`}">${t.cliente_nome || t.lead_nome}</a>
          <small class="dica">${t.responsavel || ""}</small></li>`)}</ul>
        <p class="dica"><a href="/sistema/crm?visao=followups">Ver todos os follow-ups</a></p>
      </details>` : ""}

      <details class="compromissos" open>
        <summary><h2>Próximos Compromissos</h2></summary>
        ${proximos.length ? proximos.map((p) => html`<article class="compromisso">
          <div class="compromisso-acoes">
            <a href="/sistema/prazos/${String(p.id)}" title="Editar prazo" aria-label="Editar prazo">${icone.lapis(26)}</a>
          </div>
          <div class="compromisso-dados">
            <dl>
              <div><dt>Pasta</dt><dd>${p.pasta || "—"} ${p.processo_id ? html`<a href="/sistema/processos/${String(p.processo_id)}" title="Abrir processo" class="icone-link">${icone.seta()}</a>` : ""}</dd></div>
              <div><dt>Cliente</dt><dd>${p.cliente || "—"}</dd></div>
              <div><dt>${p.categoria === "Compromisso" ? "Compromisso" : "Prazo"}</dt><dd><a href="/sistema/prazos/${String(p.id)}">${p.titulo}</a> <span class="selo ${p.categoria === "Compromisso" ? "selo-compromisso" : "selo-prazo"}">${p.categoria === "Compromisso" ? "Compromisso" : "Prazo"}</span></dd></div>
            </dl>
            <dl>
              <div><dt>Número do processo</dt><dd>${p.numero || "—"}</dd></div>
              <div class="compromisso-descricao"><dt>${icone.folha(16)} Descrição</dt><dd>${resumoTexto(p.descricao)}</dd></div>
            </dl>
            <dl class="compromisso-status">
              <div><dt>Prazo interno</dt><dd>${status(p.interno)}</dd></div>
              <div><dt>Prazo fatal</dt><dd>${dataBR(p.prazo_fatal)} ${urgencia(p.prazo_fatal)}</dd></div>
            </dl>
          </div>
          <form method="post" action="/sistema/prazos/${String(p.id)}/cumprir" class="compromisso-check">${campoCsrf(sessao)}
            <button type="submit" title="Marcar como cumprido" aria-label="Marcar como cumprido"></button></form>
        </article>`) : html`<p class="vazio">Nenhum prazo em aberto.</p>`}
      </details>`,
  }));
}

// Busca tolerante: ignora acentos e maiúsculas, aceita várias palavras em qualquer ordem
// e compara números de processo só pelos dígitos. O volume do escritório permite filtrar em memória.
const normalizar = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

export function criarFiltro(q) {
  const palavras = normalizar(q).split(/\s+/).filter(Boolean);
  return (...campos) => {
    const texto = normalizar(campos.join(" "));
    const nums = campos.map((c) => digitos(c ?? "")).filter(Boolean);
    // cada palavra precisa aparecer no texto; números (3+ dígitos) também valem sem pontuação
    return palavras.every((p) => texto.includes(p) || (digitos(p).length >= 3 && nums.some((n) => n.includes(digitos(p)))));
  };
}

// Busca geral: apenas processos e clientes, por nome das partes, número do processo e pasta.
async function buscarTudo(env, q, limite = { procs: 100, clis: 100 }) {
  let procs = [], clis = [];
  if (q) {
    const bate = criarFiltro(q);
    const [a, b] = await Promise.all([
      env.DB.prepare(`SELECT p.id, p.pasta, p.numero, p.parte_contraria, p.situacao, p.tipo_acao, c.nome AS cliente
        FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id ORDER BY CAST(p.pasta AS INTEGER), p.pasta`).all(),
      env.DB.prepare("SELECT id, nome, cidade, estado FROM clientes ORDER BY nome").all(),
    ]);
    procs = a.results.filter((p) => bate(p.pasta, p.numero, p.cliente, p.parte_contraria)).slice(0, limite.procs);
    clis = b.results.filter((c) => bate(c.nome)).slice(0, limite.clis);
  }
  return { procs, clis };
}

// Sugestões para a barra de busca (JSON), conforme o usuário digita.
export async function buscaSugestoes(req, env) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  const json = (corpo) => new Response(JSON.stringify(corpo), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  if (q.length < 2) return json({ itens: [] });
  const { procs, clis } = await buscarTudo(env, q, { procs: 8, clis: 6 });
  const itens = [
    ...clis.map((c) => ({ grupo: "Clientes", titulo: c.nome, detalhe: [c.cidade, c.estado].filter(Boolean).join(" / "), url: `/sistema/clientes/${c.id}` })),
    ...procs.map((p) => ({ grupo: "Processos", titulo: `${p.pasta ? `Pasta ${p.pasta} · ` : ""}${p.numero || "sem número"}`, detalhe: [p.cliente, p.parte_contraria].filter(Boolean).join(" × "), url: `/sistema/processos/${p.id}` })),
  ];
  return json({ itens });
}

export async function busca(req, env, sessao) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  const { procs, clis } = await buscarTudo(env, q);
  const total = procs.length + clis.length;
  return resposta(pagina({
    titulo: "Busca", sessao,
    corpo: html`<h1>Busca</h1>
      <form class="busca" method="get" action="/sistema/busca">
        <input name="q" value="${q}" placeholder="Nome da parte, número do processo ou pasta" aria-label="Buscar" autofocus>
        <button type="submit">Buscar</button>
      </form>
      ${q ? html`<p class="dica">${String(total)} resultado(s) para “${q}”.</p>` : ""}
      ${q ? html`
      <section class="cartao"><h2>Clientes (${String(clis.length)})</h2>
        ${clis.length ? html`<ul class="lista-simples">${clis.map((c) => html`<li><a href="/sistema/clientes/${String(c.id)}">${c.nome}</a><span>${[c.cidade, c.estado].filter(Boolean).join(" / ")}</span></li>`)}</ul>` : html`<p class="vazio">Nenhum cliente encontrado.</p>`}
      </section>
      <section class="cartao"><h2>Processos (${String(procs.length)})</h2>
        ${procs.length ? html`<ul class="lista-simples">${procs.map((p) => html`<li><span><a href="/sistema/processos/${String(p.id)}">${p.pasta ? `Pasta ${p.pasta} · ` : ""}${p.numero || "sem número"}</a><br><small>${[p.cliente, p.parte_contraria].filter(Boolean).join(" × ")}${p.tipo_acao ? ` · ${p.tipo_acao}` : ""}</small></span><span>${p.situacao}</span></li>`)}</ul>` : html`<p class="vazio">Nenhum processo encontrado.</p>`}
      </section>
      ` : ""}`,
  }));
}

export async function clientes(req, env, sessao, id) {
  if (!id) {
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") || "").trim().slice(0, 100);
    const origem = (sp.get("origem") || "").slice(0, 100), etiqueta = (sp.get("etiqueta") || "").slice(0, 40);
    const { results: todos } = await env.DB.prepare(
      `SELECT c.id, c.nome, c.tipo, c.cidade, c.estado, c.origem, c.etiquetas, COUNT(p.id) AS processos
         FROM clientes c LEFT JOIN processos p ON p.cliente_id = c.id
        GROUP BY c.id ORDER BY c.nome COLLATE NOCASE`
    ).all();
    const bate = criarFiltro(q);
    const temEtiqueta = (c) => etiquetasDe(c.etiquetas).some((e) => e.toLocaleLowerCase("pt-BR") === etiqueta.toLocaleLowerCase("pt-BR"));
    const results = todos.filter((c) => (!q || bate(c.nome, c.etiquetas)) && (!origem || c.origem === origem) && (!etiqueta || temEtiqueta(c)));
    const origens = (await obterListas(env, ["origem_cliente"])).origem_cliente;
    const etiquetas = [...new Map(todos.flatMap((c) => etiquetasDe(c.etiquetas)).map((e) => [e.toLocaleLowerCase("pt-BR"), e])).values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
    const opc = (valores, sel, vazio) => html`<option value="">${vazio}</option>${valores.map((v) => html`<option value="${v}"${v === sel ? html` selected` : ""}>${v}</option>`)}`;
    return resposta(pagina({
      titulo: "Clientes", sessao,
      corpo: html`
        <div class="titulo-acoes"><h1>Clientes</h1><span class="botoes-titulo"><a class="botao-link botao-secundario" href="/sistema/crm/leads/novo">Novo potencial cliente</a><a class="botao-link" href="/sistema/clientes/novo">Novo cliente</a></span></div>
        ${abasClientes("clientes")}
        <form class="busca filtros-crm" method="get"><input name="q" value="${q}" placeholder="Buscar por nome ou etiqueta" aria-label="Buscar por nome ou etiqueta">
          <select name="origem" aria-label="Origem">${opc(origens, origem, "Todas as origens")}</select>
          ${etiquetas.length ? html`<select name="etiqueta" aria-label="Etiqueta">${opc(etiquetas, etiqueta, "Todas as etiquetas")}</select>` : ""}
          <button type="submit">Buscar</button>${q || origem || etiqueta ? html`<a class="botao-link botao-secundario" href="/sistema/clientes">Limpar</a>` : ""}</form>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>Nome</th><th>Tipo</th><th>Cidade</th><th>Origem</th><th>Processos</th></tr></thead>
          <tbody>${results.map((c) => html`<tr>
            <td><a href="/sistema/clientes/${String(c.id)}">${c.nome}</a>${chips(c.etiquetas)}</td><td>${c.tipo}</td>
            <td>${[c.cidade, c.estado].filter(Boolean).join(" / ")}</td><td>${c.origem || ""}</td><td>${String(c.processos)}</td></tr>`)}</tbody>
        </table></div>
        <p class="dica">${String(results.length)} cliente(s).</p>`,
    }));
  }
  const c = await env.DB.prepare("SELECT * FROM clientes WHERE id = ?").bind(Number(id)).first();
  if (!c) return naoEncontrado(sessao);
  const [documento, nascimento, email, telefone, endereco, observacoes] = await Promise.all(
    ["documento_enc", "data_nascimento_enc", "email_enc", "telefone_enc", "endereco_enc", "observacoes_enc"].map((k) => decifrar(env, c[k]))
  );
  const { results: procs } = await env.DB.prepare("SELECT id, pasta, numero, tipo_acao, situacao FROM processos WHERE cliente_id = ? ORDER BY pasta").bind(c.id).all();
  await auditar(env, req, sessao.usuario_id, "cliente_visualizado", `cliente ${c.id}`);
  const fin = await cartaoFinanceiro(env, sessao, { clienteId: c.id });
  const lead = await env.DB.prepare("SELECT id FROM leads WHERE cliente_id = ? ORDER BY id DESC LIMIT 1").bind(c.id).first();
  const relacionamento = await blocoRelacionamento(env, sessao, { clienteId: c.id, voltar: `/sistema/clientes/${c.id}` });
  return resposta(pagina({
    titulo: c.nome, sessao, ...mensagemDaUrl(req), ...mensagemCrm(req),
    corpo: html`
      <p class="trilha"><a href="/sistema/clientes">Clientes</a></p>
      <div class="titulo-acoes"><h1>${c.nome}</h1><a class="botao-link botao-secundario" href="/sistema/clientes/${String(c.id)}/editar">Editar</a></div>
      <section class="cartao"><dl class="ficha">
        ${campo("Tipo", c.tipo)}${campo("CPF/CNPJ", documento)}${campo("Nascimento", nascimento)}
        ${campo("E-mail", email)}${campo("Telefone", telefone)}${campo("Endereço", endereco)}
        ${campo("Cidade", [c.cidade, c.estado].filter(Boolean).join(" / "))}${campo("Profissão", c.profissao)}
        ${campo("Estado civil", c.estado_civil)}${campo("Posição", c.posicao)}${campo("Cadastro", dataBR(c.data_cadastro))}
        ${campo("Origem", c.origem)}${lead ? html`<div><dt>Prospecção</dt><dd><a href="/sistema/crm/leads/${String(lead.id)}">ver histórico no funil</a></dd></div>` : ""}
      </dl>${chips(c.etiquetas)}${observacoes ? html`<h3>Observações</h3><p class="pre">${observacoes}</p>` : ""}</section>
      <section class="cartao"><div class="titulo-acoes"><h2>Processos</h2><a class="botao-link" href="/sistema/processos/novo?cliente=${String(c.id)}">Novo processo</a></div>
        ${procs.length ? html`<ul class="lista-simples">${procs.map((p) => html`<li><a href="/sistema/processos/${String(p.id)}">${p.pasta ? `Pasta ${p.pasta} · ` : ""}${p.numero || "sem número"}</a> <span>${p.tipo_acao} ${p.situacao ? `· ${p.situacao}` : ""}</span></li>`)}</ul>` : html`<p>Nenhum processo vinculado.</p>`}
      </section>
      ${fin}
      ${relacionamento}`,
  }));
}

export async function processos(req, env, sessao, id) {
  if (!id) {
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") || "").trim().slice(0, 100);
    const situacao = (sp.get("situacao") || "").slice(0, 100);
    let sql = `SELECT p.id, p.pasta, p.numero, p.tipo_acao, p.situacao, p.fase, p.comarca, p.uf, p.parte_contraria, c.nome AS cliente
                 FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE 1 = 1`;
    const args = [];
    if (situacao) {
      sql += situacao === "Sem situação" ? " AND COALESCE(p.situacao, '') = ''" : " AND p.situacao = ?1";
      if (situacao !== "Sem situação") args.push(situacao);
    }
    sql += " ORDER BY CAST(p.pasta AS INTEGER), p.pasta";
    const { results: todos } = await env.DB.prepare(sql).bind(...args).all();
    const bate = criarFiltro(q);
    const results = q ? todos.filter((p) => bate(p.numero, p.pasta, p.cliente, p.parte_contraria)) : todos;
    return resposta(pagina({
      titulo: "Processos", sessao,
      corpo: html`
        <div class="titulo-acoes"><h1>Processos${situacao ? html` · ${situacao}` : ""}</h1><a class="botao-link" href="/sistema/processos/novo">Novo processo</a></div>
        <form class="busca" method="get">
          <input name="q" value="${q}" placeholder="Número, pasta, cliente ou parte contrária" aria-label="Buscar processos">
          ${situacao ? html`<input type="hidden" name="situacao" value="${situacao}">` : ""}
          <button type="submit">Buscar</button>
        </form>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>Pasta</th><th>Número</th><th>Cliente</th><th>Ação</th><th>Situação</th><th>Comarca</th></tr></thead>
          <tbody>${results.map((p) => html`<tr>
            <td>${p.pasta}</td><td><a href="/sistema/processos/${String(p.id)}">${p.numero || "sem número"}</a></td>
            <td>${p.cliente}</td><td>${p.tipo_acao}</td><td>${p.situacao}</td><td>${[p.comarca, p.uf].filter(Boolean).join(" / ")}</td></tr>`)}</tbody>
        </table></div>
        <p class="dica">${String(results.length)} processo(s).</p>`,
    }));
  }
  return fichaProcesso(req, env, sessao, id);
}
