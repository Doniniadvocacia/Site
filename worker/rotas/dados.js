// Painel, clientes e processos (consulta). Na etapa 1 os dados vêm do Wix e são só para leitura.
import { html, pagina, resposta, dataBR, moeda } from "../html.js";
import { decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR, somarDias } from "../calendario.js";
import { urgencia, rotuloProcesso } from "./comum.js";
import { icone } from "../icones.js";
import { campoCsrf } from "../html.js";

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
        SUM(CASE WHEN COALESCE(prazo_interno, prazo_fatal) > ?1 THEN 1 ELSE 0 END) AS futuros FROM prazos WHERE situacao = 'aberto'`).bind(hoje).first(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(fase), ''), 'Sem fase') AS rotulo, COUNT(*) AS n FROM processos WHERE NOT ${INATIVO} GROUP BY 1`).all(),
    env.DB.prepare(`SELECT COALESCE(NULLIF(TRIM(COALESCE(NULLIF(resultado_atual, ''), resultado)), ''), '') AS rotulo, COUNT(*) AS n FROM processos GROUP BY 1`).all(),
    env.DB.prepare(`SELECT titulo, data, hora FROM (
        SELECT titulo, data, hora FROM agenda WHERE situacao = 'agendado' AND data >= ?1 AND LOWER(COALESCE(tipo, '') || titulo) LIKE '%audi%'
        UNION ALL SELECT titulo, data_audiencia AS data, hora_audiencia AS hora FROM prazos WHERE situacao = 'aberto' AND data_audiencia >= ?1)
      ORDER BY data, hora LIMIT 3`).bind(hoje).all(),
    env.DB.prepare(`SELECT p.id, p.titulo, p.tipo, p.descricao, p.prazo_fatal, COALESCE(p.prazo_interno, p.prazo_fatal) AS interno,
        pr.id AS processo_id, pr.pasta, pr.numero, c.nome AS cliente
      FROM prazos p LEFT JOIN processos pr ON pr.id = p.processo_id LEFT JOIN clientes c ON c.id = pr.cliente_id
      WHERE p.situacao = 'aberto' ORDER BY interno, p.prazo_fatal LIMIT 25`).all(),
  ]);
  const total = proc.total || 0, ativos = proc.ativos || 0;
  const pct = total ? Math.round((ativos / total) * 100) : 0;
  const [, mes, dia] = hoje.split("-");
  const fases = ordenar(ativosFase.results, ORDEM_FASES);
  const res = ordenar(resultados.results.filter((r) => r.rotulo), ORDEM_RESULTADOS);
  const status = (d) => (d < hoje ? html`<span class="atraso">PRAZO EM ATRASO</span>` : d === hoje ? html`<span class="atraso">HOJE</span>` : html`<span>${dataBR(d)}</span>`);
  const resumoTexto = (t) => { const x = String(t || "").replace(/\s+/g, " ").trim(); return x.length > 140 ? x.slice(0, 140) + "…" : x; };

  return resposta(pagina({
    titulo: "Visão geral", sessao,
    corpo: html`
      <div class="titulo-painel">
        <div><h1>Visão Geral</h1><p>Acompanhe a visão geral dos processos e clientes aqui!</p></div>
        <div class="botoes-pilula"><a href="/sistema/prazos/novo">Novo Prazo</a><a href="/sistema/agenda/novo">Novo Compromisso</a></div>
      </div>

      <div class="destaques">
        <div class="cartao-data"><span class="cartao-data-mes">${MESES[Number(mes) - 1]}</span><span class="cartao-data-dia">${String(Number(dia))}</span></div>
        <a class="destaque verde" href="/sistema/processos">
          <span class="marca-agua">${icone.balanca(130)}</span>
          <h2>Processos</h2>
          <div class="destaque-numero"><strong>${String(ativos)}</strong><span>Ativos</span></div>
          <div class="destaque-rodape"><span>Percentual de Ativos</span><span>${String(pct)}%</span></div>
        </a>
        <a class="destaque azul" href="/sistema/prazos">
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

      <details class="compromissos" open>
        <summary>Proximos Compromissos</summary>
        ${proximos.length ? proximos.map((p) => html`<article class="compromisso">
          <div class="compromisso-acoes">
            <a href="/sistema/prazos/${String(p.id)}" title="Editar prazo" aria-label="Editar prazo">${icone.lapis(26)}</a>
          </div>
          <div class="compromisso-dados">
            <dl>
              <div><dt>Pasta:</dt><dd>${p.pasta || "—"} ${p.processo_id ? html`<a href="/sistema/processos/${String(p.processo_id)}" title="Abrir processo" class="icone-link">${icone.seta()}</a>` : ""}</dd></div>
              <div><dt>Cliente:</dt><dd>${p.cliente || "—"}</dd></div>
              <div><dt>Prazo:</dt><dd><a href="/sistema/prazos/${String(p.id)}">${p.titulo}</a></dd></div>
            </dl>
            <dl>
              <div><dt>Número Processo:</dt><dd>${p.numero || "—"}</dd></div>
              <div class="compromisso-descricao"><dt>${icone.folha(16)} Descrição:</dt><dd>${resumoTexto(p.descricao)}</dd></div>
            </dl>
            <dl class="compromisso-status">
              <div><dt>Prazo Interno:</dt><dd>${status(p.interno)}</dd></div>
              <div><dt>Prazo fatal:</dt><dd>${dataBR(p.prazo_fatal)} ${urgencia(p.prazo_fatal)}</dd></div>
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

function criarFiltro(q) {
  const palavras = normalizar(q).split(/\s+/).filter(Boolean);
  return (...campos) => {
    const texto = normalizar(campos.join(" "));
    const nums = digitos(campos.join(" "));
    // cada palavra precisa aparecer no texto; números (3+ dígitos) também valem sem pontuação
    return palavras.every((p) => texto.includes(p) || (digitos(p).length >= 3 && nums.includes(digitos(p))));
  };
}

export async function busca(req, env, sessao) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  let procs = [], clis = [], przs = [], pubs = [];
  if (q) {
    const bate = criarFiltro(q);
    const [a, b, c, d] = await Promise.all([
      env.DB.prepare(`SELECT p.id, p.pasta, p.numero, p.parte_contraria, p.situacao, p.tipo_acao, p.comarca, p.advogado_responsavel, c.nome AS cliente
        FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id ORDER BY CAST(p.pasta AS INTEGER), p.pasta`).all(),
      env.DB.prepare("SELECT id, nome, cidade, estado, profissao FROM clientes ORDER BY nome").all(),
      env.DB.prepare(`SELECT z.id, z.titulo, z.tipo, z.descricao, z.prazo_fatal, z.situacao, z.responsavel, pr.pasta, pr.numero, c.nome AS cliente
        FROM prazos z LEFT JOIN processos pr ON pr.id = z.processo_id LEFT JOIN clientes c ON c.id = pr.cliente_id ORDER BY z.prazo_fatal DESC`).all(),
      env.DB.prepare(`SELECT id, data_disponibilizacao, tribunal, tipo, numero_processo, texto, situacao FROM publicacoes ORDER BY data_disponibilizacao DESC LIMIT 2000`).all(),
    ]);
    procs = a.results.filter((p) => bate(p.pasta, p.numero, p.parte_contraria, p.cliente, p.tipo_acao, p.comarca, p.situacao, p.advogado_responsavel)).slice(0, 100);
    clis = b.results.filter((c) => bate(c.nome, c.cidade, c.estado, c.profissao)).slice(0, 100);
    przs = c.results.filter((z) => bate(z.titulo, z.tipo, z.descricao, z.responsavel, z.pasta, z.numero, z.cliente)).slice(0, 100);
    pubs = d.results.filter((u) => bate(u.numero_processo, u.tribunal, u.tipo, u.texto)).slice(0, 50);
  }
  const trecho = (t) => { const x = String(t || "").replace(/\s+/g, " ").trim(); return x.length > 120 ? x.slice(0, 120) + "…" : x; };
  const total = procs.length + clis.length + przs.length + pubs.length;
  return resposta(pagina({
    titulo: "Busca", sessao,
    corpo: html`<h1>Busca</h1>
      <form class="busca" method="get" action="/sistema/busca">
        <input name="q" value="${q}" placeholder="Nome, número do processo, pasta, prazo..." aria-label="Buscar" autofocus>
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
      <section class="cartao"><h2>Prazos (${String(przs.length)})</h2>
        ${przs.length ? html`<ul class="lista-simples">${przs.map((z) => html`<li><span><a href="/sistema/prazos/${String(z.id)}">${z.titulo}</a><br><small>${[z.pasta && `Pasta ${z.pasta}`, z.cliente].filter(Boolean).join(" · ")}</small></span><span>${dataBR(z.prazo_fatal)} ${urgencia(z.prazo_fatal, z.situacao)} ${z.situacao !== "aberto" ? z.situacao : ""}</span></li>`)}</ul>` : html`<p class="vazio">Nenhum prazo encontrado.</p>`}
      </section>
      ${pubs.length ? html`<section class="cartao"><h2>Intimações (${String(pubs.length)})</h2><ul class="lista-simples">${pubs.map((u) => html`<li><span><a href="/sistema/publicacoes/${String(u.id)}">${dataBR(u.data_disponibilizacao)} · ${u.tribunal || ""} · ${u.numero_processo || ""}</a><br><small>${trecho(u.texto)}</small></span><span>${u.situacao === "pendente" ? "para triagem" : ""}</span></li>`)}</ul></section>` : ""}` : ""}`,
  }));
}

export async function clientes(req, env, sessao, id) {
  if (!id) {
    const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
    const { results: todos } = await env.DB.prepare(
      `SELECT c.id, c.nome, c.tipo, c.cidade, c.estado, COUNT(p.id) AS processos
         FROM clientes c LEFT JOIN processos p ON p.cliente_id = c.id
        GROUP BY c.id ORDER BY c.nome COLLATE NOCASE`
    ).all();
    const bate = criarFiltro(q);
    const results = q ? todos.filter((c) => bate(c.nome, c.cidade, c.estado, c.tipo)) : todos;
    return resposta(pagina({
      titulo: "Clientes", sessao,
      corpo: html`
        <h1>Clientes</h1>
        <form class="busca" method="get"><input name="q" value="${q}" placeholder="Buscar por nome" aria-label="Buscar por nome"><button type="submit">Buscar</button></form>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>Nome</th><th>Tipo</th><th>Cidade</th><th>Processos</th></tr></thead>
          <tbody>${results.map((c) => html`<tr>
            <td><a href="/sistema/clientes/${String(c.id)}">${c.nome}</a></td><td>${c.tipo}</td>
            <td>${[c.cidade, c.estado].filter(Boolean).join(" / ")}</td><td>${String(c.processos)}</td></tr>`)}</tbody>
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
  return resposta(pagina({
    titulo: c.nome, sessao,
    corpo: html`
      <p class="trilha"><a href="/sistema/clientes">Clientes</a></p>
      <h1>${c.nome}</h1>
      <section class="cartao"><dl class="ficha">
        ${campo("Tipo", c.tipo)}${campo("CPF/CNPJ", documento)}${campo("Nascimento", nascimento)}
        ${campo("E-mail", email)}${campo("Telefone", telefone)}${campo("Endereço", endereco)}
        ${campo("Cidade", [c.cidade, c.estado].filter(Boolean).join(" / "))}${campo("Profissão", c.profissao)}
        ${campo("Estado civil", c.estado_civil)}${campo("Posição", c.posicao)}${campo("Cadastro", dataBR(c.data_cadastro))}
      </dl>${observacoes ? html`<h3>Observações</h3><p class="pre">${observacoes}</p>` : ""}</section>
      <section class="cartao"><h2>Processos</h2>
        ${procs.length ? html`<ul class="lista-simples">${procs.map((p) => html`<li><a href="/sistema/processos/${String(p.id)}">${p.pasta ? `Pasta ${p.pasta} · ` : ""}${p.numero || "sem número"}</a> <span>${p.tipo_acao} ${p.situacao ? `· ${p.situacao}` : ""}</span></li>`)}</ul>` : html`<p>Nenhum processo vinculado.</p>`}
      </section>`,
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
    const results = q ? todos.filter((p) => bate(p.numero, p.pasta, p.cliente, p.parte_contraria, p.tipo_acao, p.comarca)) : todos;
    return resposta(pagina({
      titulo: "Processos", sessao,
      corpo: html`
        <h1>Processos${situacao ? html` · ${situacao}` : ""}</h1>
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
  const p = await env.DB.prepare("SELECT p.*, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?").bind(Number(id)).first();
  if (!p) return naoEncontrado(sessao);
  const [contato, observacoes] = await Promise.all([decifrar(env, p.contato_parte_contraria_enc), decifrar(env, p.observacoes_enc)]);
  await auditar(env, req, sessao.usuario_id, "processo_visualizado", `processo ${p.id}`);
  const [{ results: prz }, { results: pubs }, { results: ags }] = await Promise.all([
    env.DB.prepare("SELECT id, titulo, prazo_fatal, situacao FROM prazos WHERE processo_id = ? ORDER BY prazo_fatal DESC").bind(p.id).all(),
    env.DB.prepare("SELECT id, data_disponibilizacao, tipo, situacao FROM publicacoes WHERE processo_id = ? ORDER BY data_disponibilizacao DESC LIMIT 30").bind(p.id).all(),
    env.DB.prepare("SELECT id, titulo, data, hora FROM agenda WHERE processo_id = ? ORDER BY data DESC").bind(p.id).all(),
  ]);
  return resposta(pagina({
    titulo: p.numero || `Pasta ${p.pasta}`, sessao,
    corpo: html`
      <p class="trilha"><a href="/sistema/processos">Processos</a></p>
      <h1>${p.numero || "Processo sem número"}</h1>
      <p class="subtitulo">${p.pasta ? `Pasta ${p.pasta}` : ""} ${p.cliente_id ? html`· <a href="/sistema/clientes/${String(p.cliente_id)}">${p.cliente_nome}</a>` : ""}</p>
      ${secao("", [campo("Tipo de ação", p.tipo_acao), campo("Rito", p.rito), campo("Fase", p.fase), campo("Instância", p.instancia),
        campo("Situação", p.situacao), campo("Competência", p.competencia), campo("Comarca", [p.comarca, p.uf].filter(Boolean).join(" / ")),
        campo("Vara", p.vara), campo("Posição do cliente", p.posicao_cliente), campo("AJG deferida", p.ajg_deferida),
        campo("Valor da causa", moeda(p.valor_causa)), campo("Distribuição", dataBR(p.data_distribuicao)),
        campo("Advogado responsável", p.advogado_responsavel), campo("Próximo prazo", dataBR(p.proximo_prazo))])}
      ${secao("Parte contrária", [campo("Nome", p.parte_contraria), campo("Advogado", p.advogado_parte_contraria), campo("Contato", contato)])}
      ${secao("Resultados", [campo("Resultado", p.resultado), campo("Resultado atual", p.resultado_atual),
        campo("1ª instância", [p.resultado_primeira, dataBR(p.data_decisao_primeira)].filter(Boolean).join(" · ")),
        campo("2ª instância", [p.resultado_segunda, dataBR(p.data_decisao_segunda)].filter(Boolean).join(" · ")),
        campo("Instância superior", [p.resultado_superior, dataBR(p.data_decisao_superior)].filter(Boolean).join(" · ")),
        campo("Decisão final", dataBR(p.data_decisao_final))],
        observacoes ? html`<h3>Observações</h3><p class="pre">${observacoes}</p>` : "")}
      <section class="cartao"><div class="titulo-acoes"><h2>Prazos</h2><a class="botao-link" href="/sistema/prazos/novo?processo=${String(p.id)}">Novo prazo</a></div>
        ${prz.length ? html`<ul class="lista-simples">${prz.map((x) => html`<li><a href="/sistema/prazos/${String(x.id)}">${x.titulo}</a><span>${dataBR(x.prazo_fatal)} ${urgencia(x.prazo_fatal, x.situacao)} ${x.situacao !== "aberto" ? x.situacao : ""}</span></li>`)}</ul>` : html`<p>Nenhum prazo.</p>`}</section>
      <section class="cartao"><div class="titulo-acoes"><h2>Agenda</h2><a class="botao-link" href="/sistema/agenda/novo?processo=${String(p.id)}">Novo compromisso</a></div>
        ${ags.length ? html`<ul class="lista-simples">${ags.map((x) => html`<li><a href="/sistema/agenda/${String(x.id)}">${x.titulo}</a><span>${dataBR(x.data)} ${x.hora || ""}</span></li>`)}</ul>` : html`<p>Nenhum compromisso.</p>`}</section>
      ${pubs.length ? html`<section class="cartao"><h2>Intimações</h2><ul class="lista-simples">${pubs.map((x) => html`<li><a href="/sistema/publicacoes/${String(x.id)}">${dataBR(x.data_disponibilizacao)} · ${x.tipo || "Intimação"}</a><span>${x.situacao === "pendente" ? "para triagem" : ""}</span></li>`)}</ul></section>` : ""}
`,
  }));
}
