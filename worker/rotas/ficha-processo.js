// Ficha do processo: mesmos blocos do Diligo no Wix (pasta, processo, outras informações, decisões,
// observações, histórico, processos vinculados, agenda e financeiro), no visual atual.
import { msConfigurado } from "../microsoft.js";
import { html, pagina, resposta, campoCsrf, dataBR, moeda, textoDeHtml } from "../html.js";
import { decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { urgencia, bloco } from "./comum.js";
import { cartaoHistorico, mensagemDaUrl } from "./historico.js";
import { cartaoFinanceiro } from "./financeiro.js";


const campo = (rotulo, valor, { largo = false } = {}) =>
  html`<div class="${largo ? "largo" : ""}"><dt>${rotulo}</dt><dd>${valor === null || valor === undefined || valor === "" ? html`<span class="vazio-campo">—</span>` : valor}</dd></div>`;
const ficha = (...campos) => html`<dl class="ficha ficha-processo">${campos}</dl>`;

// Pasta "0014A" pertence ao mesmo grupo de "0014".
const basePasta = (p) => String(p || "").trim().replace(/[^0-9].*$/, "").replace(/^0+(?=\d)/, "");

// Texto curto com "Mais" para expandir.
function textoCurto(t, limite = 140) {
  const x = textoDeHtml(t);
  if (!x) return "";
  if (x.length <= limite && x.split("\n").length <= 2) return html`<span class="pre">${x}</span>`;
  const resumo = x.split("\n").slice(0, 2).join("\n").slice(0, limite).replace(/\s+\S*$/, "");
  return html`<details class="mais"><summary><span class="pre">${resumo}…</span> <span class="ver-mais">Mais</span></summary><span class="pre">${x}</span></details>`;
}

export async function fichaProcesso(req, env, sessao, id) {
  const p = await env.DB.prepare("SELECT p.*, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?").bind(Number(id)).first();
  if (!p) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Registro não encontrado</h1>` }), 404);
  const [contato, observacoes, telefone, email] = await Promise.all(
    [p.contato_parte_contraria_enc, p.observacoes_enc, p.telefone_parte_contraria_enc, p.email_parte_contraria_enc].map((v) => decifrar(env, v)));
  await auditar(env, req, sessao.usuario_id, "processo_visualizado", `processo ${p.id}`);

  const base = basePasta(p.pasta);
  const [{ results: prz }, { results: ags }, { results: pubs }, { results: vinculados }, hist, fin] = await Promise.all([
    env.DB.prepare(`SELECT id, titulo, tipo, categoria, descricao, prazo_fatal, prazo_interno, situacao, data_cumprimento, responsavel FROM prazos
      WHERE processo_id = ? ORDER BY CASE situacao WHEN 'aberto' THEN 0 ELSE 1 END, COALESCE(prazo_interno, prazo_fatal) DESC`).bind(p.id).all(),
    env.DB.prepare("SELECT id, titulo, tipo, data, hora, local, situacao, observacoes FROM agenda WHERE processo_id = ? ORDER BY data DESC").bind(p.id).all(),
    env.DB.prepare("SELECT id, data_disponibilizacao, tipo, tribunal, situacao, texto FROM publicacoes WHERE processo_id = ? ORDER BY data_disponibilizacao DESC LIMIT 30").bind(p.id).all(),
    base ? env.DB.prepare(`SELECT p.id, p.pasta, p.numero, p.tipo_acao, p.situacao, p.fase, p.parte_contraria, c.nome AS cliente
      FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id != ? AND p.pasta IS NOT NULL ORDER BY p.pasta`).bind(p.id).all()
      : Promise.resolve({ results: [] }),
    cartaoHistorico(env, sessao, p.id, req),
    cartaoFinanceiro(env, sessao, { processoId: p.id }),
  ]);
  // Arquivos do processo: anexos do histórico e, para quem tem acesso ao Financeiro, dos lançamentos.
  const { results: arquivos } = await env.DB.prepare(`
      SELECT a.id AS id, a.nome, a.tipo_mime, a.tamanho, a.chave, h.data AS data, 'Histórico' AS origem, h.descricao AS referencia, '#historico' AS ancora
        FROM historico h JOIN anexos a ON a.id = h.anexo_id WHERE h.processo_id = ?1
      ${sessao.financeiro ? `UNION ALL
      SELECT a.id AS id, a.nome, a.tipo_mime, a.tamanho, a.chave, COALESCE(f.data_pagamento, f.vencimento) AS data, 'Financeiro' AS origem, f.descricao AS referencia, '/sistema/financeiro/' || f.id AS ancora
        FROM financeiro f JOIN anexos a ON a.id = f.anexo_id WHERE f.processo_id = ?1` : ""}
      ORDER BY data DESC, id DESC`).bind(p.id).all();
  const vistos = new Set();
  const listaArquivos = arquivos.filter((a) => (vistos.has(a.id) ? false : vistos.add(a.id)));
  const tamanho = (b) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);
  const extensao = (n) => ((n || "").includes(".") ? n.split(".").pop().toUpperCase().slice(0, 4) : "ARQ");
  const ligados = vinculados.filter((v) => basePasta(v.pasta) === base);

  const decisao = (r, d) => (r || d ? [r, d && dataBR(d)].filter(Boolean).join(" · ") : null);
  const situacaoPrazo = (x) => x.situacao === "cumprido" ? html`<span class="selo selo-pago">Cumprido</span> <small>${dataBR(x.data_cumprimento)}</small>`
    : x.situacao === "cancelado" ? html`<span class="selo">Cancelado</span>` : html`<span class="selo selo-semana">Pendente</span> ${urgencia(x.prazo_fatal, x.situacao)}`;

  const agenda = [
    ...prz.map((x) => ({ ordem: x.situacao === "aberto" ? 0 : 1, data: x.prazo_interno || x.prazo_fatal, html: html`<tr>
      <td class="nowrap">${dataBR(x.prazo_interno || x.prazo_fatal)}${x.prazo_interno && x.prazo_interno !== x.prazo_fatal ? html`<br><small>fatal ${dataBR(x.prazo_fatal)}</small>` : ""}</td>
      <td><span class="selo ${x.categoria === "Compromisso" ? "selo-compromisso" : "selo-prazo"}">${x.categoria === "Compromisso" ? "Compromisso" : "Prazo"}</span><br><a href="/sistema/prazos/${String(x.id)}">${x.titulo}</a>${x.tipo && x.tipo !== x.titulo ? html`<br><small>${x.tipo}</small>` : ""}</td>
      <td class="col-descricao">${textoCurto(x.descricao)}</td>
      <td>${x.responsavel || ""}</td>
      <td class="nowrap">${situacaoPrazo(x)}</td>
      <td class="acoes-linha"><a class="icone-acao" href="/sistema/prazos/${String(x.id)}" title="Abrir" aria-label="Abrir prazo">✎</a>
        ${x.situacao === "aberto" ? html`<form method="post" action="/sistema/prazos/${String(x.id)}/cumprir" class="form-linha">${campoCsrf(sessao)}<button class="botao-check" type="submit" title="Marcar como cumprido" aria-label="Marcar como cumprido"></button></form>` : html`<span class="botao-check marcado" aria-hidden="true">✓</span>`}</td>
    </tr>` })),
    ...ags.map((x) => ({ ordem: x.situacao === "agendado" ? 0 : 1, data: x.data, html: html`<tr>
      <td class="nowrap">${dataBR(x.data)}${x.hora ? html`<br><small>${x.hora}</small>` : ""}</td>
      <td><span class="selo selo-compromisso">Compromisso</span><br><a href="/sistema/agenda/${String(x.id)}">${x.titulo}</a>${x.tipo ? html`<br><small>${x.tipo}</small>` : ""}</td>
      <td class="col-descricao">${textoCurto([x.local, x.observacoes].filter(Boolean).join(" — "))}</td>
      <td></td>
      <td class="nowrap">${x.situacao === "realizado" ? html`<span class="selo selo-pago">Realizado</span>` : x.situacao === "cancelado" ? html`<span class="selo">Cancelado</span>` : html`<span class="selo selo-semana">Agendado</span>`}</td>
      <td class="acoes-linha"><a class="icone-acao" href="/sistema/agenda/${String(x.id)}" title="Editar" aria-label="Editar compromisso">✎</a></td>
    </tr>` })),
  ].sort((a, b) => a.ordem - b.ordem || String(b.data).localeCompare(String(a.data)));

  const acoesAgenda = html`<a class="botao-link botao-pequeno" href="/sistema/prazos/novo?processo=${String(p.id)}">Novo agendamento</a>`;

  return resposta(pagina({
    titulo: p.numero || `Pasta ${p.pasta}`, sessao, ...mensagemDaUrl(req),
    corpo: html`
      <p class="trilha"><a href="/sistema/processos">Processos</a></p>
      <div class="titulo-acoes"><div><h1>${p.pasta ? `Pasta ${p.pasta}` : "Processo"}</h1>
        <p class="subtitulo">${p.numero || "sem número"}${p.cliente_id ? html` · <a href="/sistema/clientes/${String(p.cliente_id)}">${p.cliente_nome}</a>` : ""}${p.parte_contraria ? ` × ${p.parte_contraria}` : ""}</p></div>
        <span class="botoes-titulo"><a class="botao-link botao-secundario" href="/sistema/calculos?processo=${String(p.id)}">Cálculos</a>
        <a class="botao-link botao-secundario" href="/sistema/processos/${String(p.id)}/editar">Editar</a></span></div>

      ${bloco("Dados da Pasta", ficha(
        campo("Pasta", p.pasta), campo("Adv. responsável", p.advogado_responsavel),
        campo("Cliente", p.cliente_id ? html`<a href="/sistema/clientes/${String(p.cliente_id)}">${p.cliente_nome}</a>` : null),
        campo("Posição do cliente", p.posicao_cliente), campo("AJG deferida", p.ajg_deferida), campo("Parte contrária", p.parte_contraria),
        campo("Data de cadastro", dataBR(p.data_cadastro)), campo("Tipo de ação", p.tipo_acao),
        campo("Status da pasta", p.situacao ? html`<span class="selo ${/encerr|arquiv|baix/i.test(p.situacao) ? "" : "selo-pago"}">${p.situacao}</span>` : null)))}

      ${bloco("Dados do Processo", ficha(
        campo("Número (CNJ)", p.numero), campo("Data de distribuição", dataBR(p.data_distribuicao)), campo("Instância", p.instancia),
        campo("Fase processual", p.fase), campo("Valor da ação", moeda(p.valor_causa)), campo("Nº vara", p.numero_vara),
        campo("Órgão julgador", p.vara), campo("Comarca", p.comarca), campo("UF", p.uf), campo("Competência", p.competencia),
        campo("Rito processual", p.rito), campo("Data de citação", dataBR(p.data_citacao)), campo("Trânsito em julgado", dataBR(p.data_transito)),
        campo("Data do encerramento", dataBR(p.data_encerramento)), campo("Motivo do encerramento", p.motivo_encerramento)))}

      ${bloco("Outras Informações", ficha(
        campo("Advogado da parte contrária", p.advogado_parte_contraria), campo("Número OAB", p.oab_parte_contraria),
        campo("Telefone", telefone || null), campo("E-mail", email ? html`<a href="mailto:${email}">${email}</a>` : null),
        ...(contato && !telefone && !email ? [campo("Contato", contato, { largo: true })] : [])), { aberto: Boolean(p.advogado_parte_contraria || telefone || email || contato) })}

      ${bloco("Decisões", ficha(
        campo("1ª instância", decisao(p.resultado_primeira, p.data_decisao_primeira)),
        campo("2ª instância", decisao(p.resultado_segunda, p.data_decisao_segunda)),
        campo("Instâncias superiores", decisao(p.resultado_superior, p.data_decisao_superior)),
        campo("Resultado atual", decisao(p.resultado_atual || p.resultado, p.data_decisao_final))),
        { aberto: Boolean(p.resultado_primeira || p.resultado_segunda || p.resultado_superior || p.resultado_atual) })}

      ${bloco("Observações", observacoes ? html`<p class="pre">${observacoes}</p>` : html`<p class="vazio">Sem observações.</p>`, { aberto: Boolean(observacoes) })}

      ${bloco("Arquivos do Processo", listaArquivos.length ? html`<ul class="lista-arquivos">${listaArquivos.map((a) => html`<li>
          <span class="${`tipo-arquivo ${extensao(a.nome) === "PDF" ? "pdf" : /^(JPG|JPEG|PNG|WEBP|GIF)$/.test(extensao(a.nome)) ? "imagem" : ""}`}">${extensao(a.nome)}</span>
          <div class="arquivo-dados">
            ${a.chave ? html`<a class="arquivo-nome" href="/sistema/anexos/${String(a.id)}" target="_blank" rel="noopener">${a.nome}</a>` : html`<span class="arquivo-nome">${a.nome}</span> <small class="dica">(ainda não copiado do Wix)</small>`}
            <small><span class="selo ${a.origem === "Financeiro" ? "selo-arquivo-fin" : "selo-arquivo-hist"}">${a.origem}</span> ${dataBR(a.data)}${a.tamanho ? ` · ${tamanho(a.tamanho)}` : ""} · <a href="${a.ancora}">${a.referencia.length > 80 ? a.referencia.slice(0, 80) + "…" : a.referencia}</a></small>
          </div></li>`)}</ul>`
        : html`<p class="vazio">Nenhum arquivo. Os arquivos anexados no histórico${sessao.financeiro ? " e nos lançamentos financeiros" : ""} deste processo aparecem aqui.</p>`,
        { id: "arquivos", contagem: listaArquivos.length, aberto: listaArquivos.length > 0 })}

      ${msConfigurado(env) ? bloco("Pasta no SharePoint", html`<div class="sharepoint-conteudo" data-sharepoint="/sistema/processos/${String(p.id)}/sharepoint/lista"><p class="dica">Carregando arquivos do SharePoint…</p></div>
        <script src="/assets/js/sharepoint.js" defer></script>`, { id: "sharepoint", aberto: Boolean(p.sharepoint_item) || /sp_/.test(new URL(req.url).searchParams.get("msg") || "") }) : ""}

      ${hist}

      ${ligados.length ? bloco("Processos Vinculados", html`<div class="tabela-rolagem"><table>
        <thead><tr><th>Pasta</th><th>Número</th><th>Tipo de ação</th><th>Cliente</th><th>Parte contrária</th><th>Fase</th><th>Status</th></tr></thead>
        <tbody>${ligados.map((v) => html`<tr><td><a href="/sistema/processos/${String(v.id)}">${v.pasta}</a></td><td>${v.numero || "—"}</td><td>${v.tipo_acao}</td>
          <td>${v.cliente}</td><td>${v.parte_contraria}</td><td>${v.fase}</td><td>${v.situacao}</td></tr>`)}</tbody></table></div>`, { contagem: ligados.length }) : ""}

      ${bloco("Agenda", agenda.length ? html`<div class="tabela-rolagem"><table class="tabela-agenda">
        <thead><tr><th>Data</th><th>Prazo / compromisso</th><th>Descrição</th><th>Responsável</th><th>Situação</th><th></th></tr></thead>
        <tbody>${agenda.map((a) => a.html)}</tbody></table></div>` : html`<p class="vazio">Nenhum prazo ou compromisso.</p>`,
        { id: "agenda", acoes: acoesAgenda, contagem: agenda.length })}

      ${fin}

      ${pubs.length ? bloco("Intimações", html`<ul class="lista-simples">${pubs.map((x) => html`<li><span><a href="/sistema/publicacoes/${String(x.id)}">${dataBR(x.data_disponibilizacao)} · ${x.tipo || "Intimação"}${x.tribunal ? ` · ${x.tribunal}` : ""}</a></span><span>${x.situacao === "pendente" ? "para triagem" : ""}</span></li>`)}</ul>`,
        { contagem: pubs.length, aberto: false }) : ""}

      <div class="rodape-ficha"><a class="botao-link botao-secundario" href="/sistema/processos">Voltar</a>
        <a class="botao-link" href="/sistema/processos/${String(p.id)}/editar">Editar processo</a></div>`,
  }));
}
