// CRM: funil de potenciais clientes (leads), interações, follow-ups, origem e etiquetas.
// Leads ficam numa lista própria; ao fechar contrato viram cliente com os dados já preenchidos.
// Contatos, resumos de caso e anotações são gravados cifrados.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, moeda } from "../html.js";
import { agora, cifrar, decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR, somarDias } from "../calendario.js";
import { obterListas } from "../listas.js";
import { opcoes, csrfOk, txt, dataValida, numeroBR, soDigitos, formatarFone, bloco } from "./comum.js";
import { criarFiltro } from "./dados.js";
import { notificar, idsPorNome } from "../notificacoes.js";

export const ETAPAS = ["Novo contato", "Reunião agendada", "Proposta enviada", "Negociação"];
const lista = (v) => v.map((x) => [x, x]);
const comAtual = (valores, atual) => lista([...new Set([...(valores || []), ...(atual ? [atual] : [])])]);
const naoEncontrado = (sessao) => resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Registro não encontrado</h1>` }), 404);
const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const DIA = 86400;

const MSG = {
  salvo: ["aviso", "Salvo."], interacao: ["aviso", "Interação registrada."], tarefa: ["aviso", "Follow-up agendado."],
  concluida: ["aviso", "Follow-up atualizado."], excluida: ["aviso", "Registro excluído."], perdido: ["aviso", "Marcado como perdido."],
  reaberto: ["aviso", "Lead reaberto no funil."], etapa: ["aviso", "Etapa atualizada."], excluido: ["aviso", "Lead excluído."],
  sessao: ["erro", "Sessão expirada. Tente novamente."], permissao: ["erro", "Somente administradores podem excluir."], dados: ["erro", "Preencha os campos obrigatórios."], motivo: ["erro", "Informe o motivo da perda."],
};
export const mensagem = (req) => { const m = MSG[new URL(req.url).searchParams.get("msg")]; return m ? { [m[0]]: m[1] } : {}; };

// Só volta para páginas do próprio sistema.
const destinoSeguro = (v, padrao) => (typeof v === "string" && /^\/sistema\/[\w\-/?=&.%]*$/.test(v) && !v.includes("//") ? v : padrao);
const comMsg = (destino, msg) => { const [base, ancora] = destino.split("#"); return `${base}${base.includes("?") ? "&" : "?"}msg=${msg}${ancora ? `#${ancora}` : ""}`; };

// ---------- Etiquetas ----------
export const etiquetasDe = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
export const normalizarEtiquetas = (v) => {
  const vistas = new Map();
  for (const e of etiquetasDe(v)) { const k = e.toLocaleLowerCase("pt-BR"); if (!vistas.has(k)) vistas.set(k, e.slice(0, 40)); }
  return [...vistas.values()].slice(0, 12).join(", ") || null;
};
export const chips = (v) => { const e = etiquetasDe(v); return e.length ? html`<span class="etiquetas">${e.map((x) => html`<span class="etiqueta-crm">${x}</span>`)}</span>` : ""; };
export async function etiquetasUsadas(env) {
  const { results } = await env.DB.prepare("SELECT etiquetas FROM clientes WHERE COALESCE(etiquetas, '') != '' UNION ALL SELECT etiquetas FROM leads WHERE COALESCE(etiquetas, '') != ''").all();
  const todas = new Map();
  for (const r of results) for (const e of etiquetasDe(r.etiquetas)) todas.set(e.toLocaleLowerCase("pt-BR"), e);
  return [...todas.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
export const datalistEtiquetas = (valores) => html`<datalist id="etiquetas-usadas">${valores.map((v) => html`<option value="${v}">`)}</datalist>`;

// Abas da página de clientes.
export const abasClientes = (ativa) => html`<nav class="abas">
  <a href="/sistema/clientes" class="${ativa === "clientes" ? "ativa" : ""}">Clientes</a>
  <a href="/sistema/crm" class="${ativa === "funil" ? "ativa" : ""}">Funil de prospecção</a>
  <a href="/sistema/crm?visao=followups" class="${ativa === "followups" ? "ativa" : ""}">Follow-ups</a>
  <a href="/sistema/crm?visao=encerrados" class="${ativa === "encerrados" ? "ativa" : ""}">Contratados e perdidos</a>
</nav>`;

async function responsaveis(env) {
  const { results } = await env.DB.prepare("SELECT nome FROM usuarios WHERE ativo = 1 AND perfil != 'cliente' ORDER BY nome").all();
  return results.map((u) => u.nome);
}
const situacaoData = (d, hoje) => (d < hoje ? "atrasado" : d === hoje ? "hoje" : "");

// ---------- Relacionamento: interações e follow-ups (usado na ficha do lead e do cliente) ----------
export async function blocoRelacionamento(env, sessao, { leadId = null, clienteId = null, voltar }) {
  const onde = clienteId ? "(i.cliente_id = ?1 OR i.lead_id IN (SELECT id FROM leads WHERE cliente_id = ?1))" : "i.lead_id = ?1";
  const ondeT = clienteId ? "(t.cliente_id = ?1 OR t.lead_id IN (SELECT id FROM leads WHERE cliente_id = ?1))" : "t.lead_id = ?1";
  const ref = clienteId || leadId;
  const [{ results: ints }, { results: tarefas }, ls, resp] = await Promise.all([
    env.DB.prepare(`SELECT i.*, u.nome AS autor FROM crm_interacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE ${onde} ORDER BY i.data DESC, i.id DESC LIMIT 200`).bind(ref).all(),
    env.DB.prepare(`SELECT t.* FROM crm_tarefas t WHERE ${ondeT} ORDER BY t.feito, t.data, t.id LIMIT 200`).bind(ref).all(),
    obterListas(env, ["tipo_interacao"]),
    responsaveis(env),
  ]);
  const resumos = await Promise.all(ints.map((i) => decifrar(env, i.resumo_enc)));
  const hoje = hojeBR();
  const alvo = html`${leadId ? html`<input type="hidden" name="lead_id" value="${String(leadId)}">` : ""}${clienteId ? html`<input type="hidden" name="cliente_id" value="${String(clienteId)}">` : ""}<input type="hidden" name="voltar" value="${voltar}">`;
  const pendentes = tarefas.filter((t) => !t.feito);

  const formTarefa = html`<form method="post" action="/sistema/crm/tarefas" class="formulario grade-form form-crm">${campoCsrf(sessao)}${alvo}
      <label class="duplo">Próximo passo<input name="titulo" required maxlength="200" placeholder="Ex.: ligar para saber da decisão"></label>
      <label>Data<input type="date" name="data" required value="${somarDias(hoje, 3)}"></label>
      <label>Responsável<select name="responsavel">${opcoes(lista(resp), sessao.nome, "—")}</select></label>
      <div class="largo botoes-form"><button type="submit" class="botao-pequeno">Agendar follow-up</button></div></form>`;
  const listaTarefas = tarefas.length ? html`<ul class="lista-tarefas">${tarefas.map((t) => html`<li class="${t.feito ? "feita" : situacaoData(t.data, hoje)}">
      <form method="post" action="/sistema/crm/tarefas/${String(t.id)}/concluir" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="voltar" value="${voltar}">
        <button type="submit" class="caixa-tarefa" title="${t.feito ? "Reabrir" : "Marcar como feito"}" aria-label="${t.feito ? "Reabrir" : "Marcar como feito"}">${t.feito ? "✓" : ""}</button></form>
      <span class="tarefa-data">${dataBR(t.data)}</span><span class="tarefa-titulo">${t.titulo}</span><small class="dica">${t.responsavel || ""}</small></li>`)}</ul>`
    : html`<p class="vazio">Nenhum follow-up agendado.</p>`;

  const formInteracao = html`<form method="post" action="/sistema/crm/interacoes" class="formulario grade-form form-crm">${campoCsrf(sessao)}${alvo}
      <label>Tipo<select name="tipo" required>${opcoes(lista(ls.tipo_interacao), "", "Selecione…")}</select></label>
      <label>Data<input type="date" name="data" required value="${hoje}" max="${hoje}"></label>
      <label class="largo">Anotação<textarea name="resumo" rows="2" maxlength="4000" required placeholder="O que foi conversado, próximos passos combinados"></textarea></label>
      <div class="largo botoes-form"><button type="submit" class="botao-pequeno">Registrar interação</button></div></form>`;
  const listaInts = ints.length ? html`<ol class="linha-tempo">${ints.map((i, n) => html`<li>
      <div class="linha-tempo-data">${dataBR(i.data)}</div>
      <div class="linha-tempo-texto"><p><span class="selo selo-interacao">${i.tipo}</span></p><p class="pre">${resumos[n] || ""}</p>
        <div class="linha-tempo-rodape"><small class="dica">${i.autor ? `por ${i.autor}` : ""}</small>
        ${i.usuario_id === sessao.usuario_id || sessao.perfil === "admin" ? html`<a class="icone-acao" href="/sistema/crm/interacoes/${String(i.id)}?voltar=${encodeURIComponent(voltar)}" title="Editar" aria-label="Editar interação">✎</a>` : ""}</div>
      </div></li>`)}</ol>` : html`<p class="vazio">Nenhuma interação registrada.</p>`;

  return html`${bloco("Follow-ups", html`${listaTarefas}<details class="novo-item"><summary class="botao-link botao-pequeno">Novo follow-up</summary>${formTarefa}</details>`, { id: "followups", contagem: pendentes.length })}
    ${bloco("Interações", html`<details class="novo-item"${ints.length ? "" : html` open`}><summary class="botao-link botao-pequeno">Registrar interação</summary>${formInteracao}</details>${listaInts}`, { id: "interacoes", contagem: ints.length })}`;
}

// ---------- Funil, follow-ups e encerrados ----------
export async function crm(req, env, sessao) {
  const sp = new URL(req.url).searchParams;
  const visao = sp.get("visao");
  if (visao === "followups") return paginaFollowups(req, env, sessao);
  if (visao === "encerrados") return paginaEncerrados(req, env, sessao);
  const q = (sp.get("q") || "").trim().slice(0, 100);
  const resp = (sp.get("responsavel") || "").slice(0, 100);
  const hoje = hojeBR();
  const { results: todos } = await env.DB.prepare(`SELECT l.id, l.nome, l.area, l.origem, l.etiquetas, l.valor_estimado, l.responsavel, l.etapa, l.etapa_desde, l.criado_em,
      (SELECT MIN(data) FROM crm_tarefas t WHERE t.lead_id = l.id AND t.feito = 0) AS proximo,
      (SELECT MAX(data) FROM crm_interacoes i WHERE i.lead_id = l.id) AS ultimo
    FROM leads l WHERE l.etapa IN (${ETAPAS.map(() => "?").join(",")}) ORDER BY l.atualizado_em DESC, l.id DESC`).bind(...ETAPAS).all();
  const bate = criarFiltro(q);
  const leads = todos.filter((l) => (!q || bate(l.nome, l.area, l.origem, l.etiquetas)) && (!resp || l.responsavel === resp));
  const respOpcoes = await responsaveis(env);
  const t = agora();
  const cartao = (l) => html`<article class="cartao-lead" draggable="true" data-lead="${String(l.id)}" data-etapa="${l.etapa}">
      <a class="cartao-lead-nome" href="/sistema/crm/leads/${String(l.id)}">${l.nome}</a>
      ${l.area ? html`<span class="cartao-lead-area">${l.area}</span>` : ""}
      ${chips(l.etiquetas)}
      <dl class="cartao-lead-dados">
        ${l.valor_estimado ? html`<div><dt>Estimado</dt><dd>${moeda(l.valor_estimado)}</dd></div>` : ""}
        ${l.origem ? html`<div><dt>Origem</dt><dd>${l.origem}</dd></div>` : ""}
        ${l.responsavel ? html`<div><dt>Resp.</dt><dd>${l.responsavel}</dd></div>` : ""}
      </dl>
      <p class="cartao-lead-rodape">${l.proximo ? html`<span class="${`proximo ${situacaoData(l.proximo, hoje)}`}">Follow-up ${dataBR(l.proximo)}</span>` : html`<span class="proximo sem">Sem follow-up</span>`}
        <span class="dica">${String(Math.max(0, Math.floor((t - (l.etapa_desde || l.criado_em)) / DIA)))} d na etapa</span></p>
    </article>`;
  const colunas = ETAPAS.map((e) => {
    const itens = leads.filter((l) => l.etapa === e);
    const soma = itens.reduce((s, l) => s + (l.valor_estimado || 0), 0);
    return html`<section class="coluna-funil" data-etapa="${e}">
      <header><h2>${e}</h2><span class="contagem">${String(itens.length)}</span>${soma ? html`<small>${moeda(soma)}</small>` : ""}</header>
      <div class="coluna-funil-itens">${itens.map(cartao)}</div></section>`;
  });
  const { n: contratados } = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE etapa = 'Contratado' AND encerrado_em >= ?").bind(t - 90 * DIA).first();
  const { n: perdidos } = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE etapa = 'Perdido' AND encerrado_em >= ?").bind(t - 90 * DIA).first();
  return resposta(pagina({
    titulo: "Funil de prospecção", sessao, ...mensagem(req),
    corpo: html`<div class="titulo-acoes"><h1>Clientes</h1><a class="botao-link" href="/sistema/crm/leads/novo">Novo potencial cliente</a></div>
      ${abasClientes("funil")}
      <form class="busca filtros-crm" method="get">
        <input name="q" value="${q}" placeholder="Nome, área, origem ou etiqueta" aria-label="Buscar no funil">
        <select name="responsavel" aria-label="Responsável">${opcoes(lista(respOpcoes), resp, "Todos os responsáveis")}</select>
        <button type="submit">Filtrar</button>${q || resp ? html`<a class="botao-link botao-secundario" href="/sistema/crm">Limpar</a>` : ""}
      </form>
      <div class="funil" data-csrf="${sessao.csrf}">${colunas}</div>
      <p class="dica">Arraste os cartões entre as colunas para mudar a etapa. Para registrar contratação ou perda, abra o cartão.
        Últimos 90 dias: <a href="/sistema/crm?visao=encerrados">${String(contratados)} contratado(s) e ${String(perdidos)} perdido(s)</a>.</p>
      <div id="aviso-crm" class="aviso-flutuante" hidden role="status"></div>
      <script src="/assets/js/crm.js" defer></script>`,
  }));
}

async function paginaFollowups(req, env, sessao) {
  const sp = new URL(req.url).searchParams;
  const meus = sp.get("meus") === "1";
  const hoje = hojeBR();
  const { results } = await env.DB.prepare(`SELECT t.*, l.nome AS lead_nome, l.etapa, c.nome AS cliente_nome
      FROM crm_tarefas t LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN clientes c ON c.id = t.cliente_id
      WHERE t.feito = 0 ${meus ? "AND t.responsavel = ?1" : ""} ORDER BY t.data, t.id LIMIT 500`).bind(...(meus ? [sessao.nome] : [])).all();
  const voltar = `/sistema/crm?visao=followups${meus ? "&meus=1" : ""}`;
  const link = (t) => (t.cliente_id
    ? html`<a href="/sistema/clientes/${String(t.cliente_id)}">${t.cliente_nome}</a> <span class="selo">Cliente</span>`
    : html`<a href="/sistema/crm/leads/${String(t.lead_id)}">${t.lead_nome}</a> <span class="selo selo-lead">${t.etapa}</span>`);
  return resposta(pagina({
    titulo: "Follow-ups", sessao, ...mensagem(req),
    corpo: html`<div class="titulo-acoes"><h1>Clientes</h1><a class="botao-link" href="/sistema/crm/leads/novo">Novo potencial cliente</a></div>
      ${abasClientes("followups")}
      <nav class="abas sub-abas"><a href="/sistema/crm?visao=followups" class="${meus ? "" : "ativa"}">Todos</a><a href="/sistema/crm?visao=followups&meus=1" class="${meus ? "ativa" : ""}">Meus</a></nav>
      ${results.length ? html`<div class="tabela-rolagem"><table class="tabela-followups"><thead><tr><th></th><th>Data</th><th>Próximo passo</th><th>Com</th><th>Responsável</th></tr></thead>
        <tbody>${results.map((t) => html`<tr class="${situacaoData(t.data, hoje)}">
          <td><form method="post" action="/sistema/crm/tarefas/${String(t.id)}/concluir" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="voltar" value="${voltar}">
            <button type="submit" class="caixa-tarefa" title="Marcar como feito" aria-label="Marcar como feito"></button></form></td>
          <td>${dataBR(t.data)}${t.data < hoje ? html` <span class="atraso">ATRASADO</span>` : t.data === hoje ? html` <span class="atraso">HOJE</span>` : ""}</td>
          <td>${t.titulo}</td><td>${link(t)}</td><td>${t.responsavel || "—"}</td></tr>`)}</tbody></table></div>`
        : html`<p class="vazio">Nenhum follow-up pendente.</p>`}
      <p class="dica">Follow-ups são agendados na ficha do potencial cliente ou do cliente.</p>`,
  }));
}

async function paginaEncerrados(req, env, sessao) {
  const { results } = await env.DB.prepare(`SELECT l.id, l.nome, l.etapa, l.area, l.origem, l.motivo_perda, l.valor_estimado, l.encerrado_em, l.cliente_id
      FROM leads l WHERE l.etapa IN ('Contratado', 'Perdido') ORDER BY l.encerrado_em DESC LIMIT 300`).all();
  const data = (s) => (s ? new Date((s - 3 * 3600) * 1000).toISOString().slice(0, 10).split("-").reverse().join("/") : "");
  const porOrigem = {};
  for (const l of results) { const o = l.origem || "Sem origem"; porOrigem[o] ??= { c: 0, p: 0 }; porOrigem[o][l.etapa === "Contratado" ? "c" : "p"]++; }
  return resposta(pagina({
    titulo: "Contratados e perdidos", sessao, ...mensagem(req),
    corpo: html`<div class="titulo-acoes"><h1>Clientes</h1><a class="botao-link" href="/sistema/crm/leads/novo">Novo potencial cliente</a></div>
      ${abasClientes("encerrados")}
      ${Object.keys(porOrigem).length ? html`<section class="cartao"><h2>Conversão por origem</h2><div class="tabela-rolagem"><table><thead><tr><th>Origem</th><th>Contratados</th><th>Perdidos</th><th>Conversão</th></tr></thead>
        <tbody>${Object.entries(porOrigem).sort((a, b) => (b[1].c + b[1].p) - (a[1].c + a[1].p)).map(([o, v]) => html`<tr><td>${o}</td><td>${String(v.c)}</td><td>${String(v.p)}</td><td>${String(Math.round((v.c / (v.c + v.p)) * 100))}%</td></tr>`)}</tbody></table></div></section>` : ""}
      ${results.length ? html`<div class="tabela-rolagem"><table><thead><tr><th>Nome</th><th>Resultado</th><th>Área</th><th>Origem</th><th>Motivo</th><th>Data</th></tr></thead>
        <tbody>${results.map((l) => html`<tr><td><a href="/sistema/crm/leads/${String(l.id)}">${l.nome}</a></td>
          <td><span class="${`selo ${l.etapa === "Contratado" ? "selo-ganho" : "selo-perdido"}`}">${l.etapa}</span>${l.cliente_id ? html` <a href="/sistema/clientes/${String(l.cliente_id)}">ver cliente</a>` : ""}</td>
          <td>${l.area || "—"}</td><td>${l.origem || "—"}</td><td>${l.motivo_perda || "—"}</td><td>${data(l.encerrado_em)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="vazio">Nenhum lead encerrado ainda.</p>`}`,
  }));
}

// ---------- Cadastro do lead ----------
function formularioLead(sessao, l, acao, apoio) {
  return html`<form method="post" action="${acao}" class="formulario grade-form">${campoCsrf(sessao)}
    <label class="duplo">Nome<input name="nome" required maxlength="200" value="${l.nome || ""}"></label>
    <label>Tipo<select name="tipo">${opcoes(comAtual(apoio.tipos, l.tipo), l.tipo)}</select></label>
    <label>Telefone / WhatsApp<input name="telefone" maxlength="15" inputmode="tel" data-mascara="fone" placeholder="(XX) XXXXX-XXXX" value="${l.telefone || ""}"></label>
    <label>E-mail<input name="email" type="email" maxlength="200" value="${l.email || ""}"></label>
    <label>Área de interesse<select name="area">${opcoes(comAtual(apoio.areas, l.area), l.area)}</select></label>
    <label>Origem<select name="origem">${opcoes(comAtual(apoio.origens, l.origem), l.origem)}</select></label>
    <label>Indicado por<input name="indicado_por" maxlength="150" value="${l.indicado_por || ""}" placeholder="Quem indicou (se houver)"></label>
    <label>Honorários estimados (R$)<input name="valor_estimado" inputmode="decimal" maxlength="20" value="${l.valor_txt || ""}" placeholder="0,00"></label>
    <label>Responsável<select name="responsavel">${opcoes(comAtual(apoio.responsaveis, l.responsavel), l.responsavel)}</select></label>
    ${l.id ? "" : html`<label>Etapa<select name="etapa">${opcoes(lista(ETAPAS), l.etapa || ETAPAS[0], "")}</select></label>`}
    <label class="duplo">Etiquetas<input name="etiquetas" maxlength="400" list="etiquetas-usadas" value="${l.etiquetas || ""}" placeholder="Separe por vírgula: urgente, empresa, seguradora X"></label>
    <label class="largo">Resumo do caso<textarea name="resumo" rows="4" maxlength="6000" placeholder="O que o cliente procura, fatos principais, documentos que tem">${l.resumo || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit">Salvar</button></div>
    ${datalistEtiquetas(apoio.etiquetas)}
  </form>
  <p class="dica">Telefone, e-mail e resumo do caso são gravados cifrados.</p>
  <script src="/assets/js/mascaras.js" defer></script>`;
}

async function apoioLead(env) {
  const [ls, resp, etiquetas] = await Promise.all([obterListas(env, ["origem_cliente", "area_interesse", "tipo_cadastro", "motivo_perda"]), responsaveis(env), etiquetasUsadas(env)]);
  return { origens: ls.origem_cliente, areas: ls.area_interesse, tipos: ls.tipo_cadastro, motivos: ls.motivo_perda, responsaveis: resp, etiquetas };
}

export async function cadastroLead(req, env, sessao, id) {
  const existente = id ? await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(Number(id)).first() : null;
  if (id && !existente) return naoEncontrado(sessao);
  const acao = id ? `/sistema/crm/leads/${id}/editar` : "/sistema/crm/leads/novo";
  const apoio = await apoioLead(env);
  const tela = (l, erro) => resposta(pagina({
    titulo: id ? `Editar ${existente.nome}` : "Novo potencial cliente", sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/crm">Funil de prospecção</a>${id ? html` › <a href="/sistema/crm/leads/${id}">${existente.nome}</a>` : ""}</p>
      <h1>${id ? "Editar potencial cliente" : "Novo potencial cliente"}</h1>
      <section class="cartao">${formularioLead(sessao, l, acao, apoio)}
        ${id && sessao.perfil === "admin" ? html`<form method="post" action="/sistema/crm/leads/${id}/excluir" class="form-excluir-andamento"
          data-confirmar="${`Excluir ${existente.nome}, com interações e follow-ups do funil? Esta ação não pode ser desfeita.`}">${campoCsrf(sessao)}
          <input type="hidden" name="confirmar" value="1"><button type="submit" class="botao-perigo">Excluir potencial cliente</button></form>` : ""}</section>
      <script src="/assets/js/confirmar.js" defer></script>`,
  }));
  if (req.method === "GET") {
    if (!existente) return tela({ tipo: "Pessoa Física", responsavel: sessao.nome, etapa: ETAPAS[0] });
    const [telefone, email, resumo] = await Promise.all([decifrar(env, existente.telefone_enc), decifrar(env, existente.email_enc), decifrar(env, existente.resumo_enc)]);
    return tela({ ...existente, telefone, email, resumo, valor_txt: existente.valor_estimado ? existente.valor_estimado.toFixed(2).replace(".", ",") : "" });
  }
  const { f, ok } = await csrfOk(req, sessao);
  const l = {
    nome: txt(f, "nome", 200), tipo: txt(f, "tipo", 40), telefone: txt(f, "telefone", 20), email: txt(f, "email", 200),
    area: txt(f, "area", 100), origem: txt(f, "origem", 100), indicado_por: txt(f, "indicado_por", 150), valor_txt: txt(f, "valor_estimado", 20),
    responsavel: txt(f, "responsavel", 100), etapa: ETAPAS.includes(txt(f, "etapa", 40)) ? txt(f, "etapa", 40) : ETAPAS[0],
    etiquetas: normalizarEtiquetas(txt(f, "etiquetas", 400)), resumo: txt(f, "resumo", 6000),
  };
  if (!ok) return tela(l, "Sessão expirada. Tente novamente.");
  if (!l.nome) return tela(l, "Informe o nome.");
  if (l.telefone) { const d = soDigitos(l.telefone); if (d.length !== 10 && d.length !== 11) return tela(l, "Telefone: use (XX) XXXX-XXXX ou (XX) XXXXX-XXXX."); l.telefone = formatarFone(d); }
  let valor = null;
  if (l.valor_txt) { valor = numeroBR(l.valor_txt); if (!Number.isFinite(valor) || valor < 0) return tela(l, "Honorários estimados: informe um valor válido."); }
  const [telEnc, emailEnc, resumoEnc] = await Promise.all([cifrar(env, l.telefone), cifrar(env, l.email), cifrar(env, l.resumo)]);
  const t = agora();
  const v = [l.nome, l.tipo, telEnc, emailEnc, l.origem, l.indicado_por, l.area, l.etiquetas, valor, l.responsavel, resumoEnc, t];
  let novoId = existente?.id;
  if (existente) {
    await env.DB.prepare(`UPDATE leads SET nome=?1, tipo=?2, telefone_enc=?3, email_enc=?4, origem=?5, indicado_por=?6, area=?7, etiquetas=?8,
      valor_estimado=?9, responsavel=?10, resumo_enc=?11, atualizado_em=?12 WHERE id=?13`).bind(...v, existente.id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO leads (nome, tipo, telefone_enc, email_enc, origem, indicado_por, area, etiquetas, valor_estimado, responsavel,
      resumo_enc, atualizado_em, criado_em, etapa_desde, etapa) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12,?12,?13)`).bind(...v, l.etapa).run();
    novoId = r.meta.last_row_id;
  }
  if (l.responsavel && l.responsavel !== existente?.responsavel) {
    await notificar(env, { destinos: await idsPorNome(env, l.responsavel), tipo: "lead", autorId: sessao.usuario_id, link: `/sistema/crm/leads/${novoId}`,
      texto: `Potencial cliente atribuído a você: ${l.nome}${l.area ? ` · ${l.area}` : ""} (por ${sessao.nome.split(" ")[0]})` });
  }
  await auditar(env, req, sessao.usuario_id, existente ? "lead_alterado" : "lead_criado", `lead ${novoId}`);
  return redirecionar(`/sistema/crm/leads/${novoId}?msg=salvo`);
}

// ---------- Ficha do lead ----------
export async function fichaLead(req, env, sessao, id) {
  const l = await env.DB.prepare("SELECT l.*, c.nome AS cliente_nome FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id WHERE l.id = ?").bind(Number(id)).first();
  if (!l) return naoEncontrado(sessao);
  const [telefone, email, resumo] = await Promise.all([decifrar(env, l.telefone_enc), decifrar(env, l.email_enc), decifrar(env, l.resumo_enc)]);
  await auditar(env, req, sessao.usuario_id, "lead_visualizado", `lead ${l.id}`);
  const apoio = await apoioLead(env);
  const voltar = `/sistema/crm/leads/${l.id}`;
  const campo = (r, v) => (v ? html`<div><dt>${r}</dt><dd>${v}</dd></div>` : "");
  const aberto = ETAPAS.includes(l.etapa);
  const fone = soDigitos(telefone);
  const acoes = aberto ? html`<section class="cartao acoes-lead">
      <form method="post" action="/sistema/crm/leads/${String(l.id)}/etapa" class="form-linha form-etapa">${campoCsrf(sessao)}
        <label>Etapa<select name="etapa">${opcoes(lista(ETAPAS), l.etapa, "")}</select></label><button type="submit" class="botao-secundario">Mudar etapa</button></form>
      <form method="post" action="/sistema/crm/leads/${String(l.id)}/converter" class="form-linha">${campoCsrf(sessao)}
        <button type="submit" class="botao-ganho">Contrato fechado: converter em cliente</button></form>
      <details class="perder"><summary class="botao-link botao-secundario">Marcar como perdido</summary>
        <form method="post" action="/sistema/crm/leads/${String(l.id)}/perder" class="formulario form-linha">${campoCsrf(sessao)}
          <label>Motivo<select name="motivo" required>${opcoes(lista(apoio.motivos), "", "Selecione…")}</select></label><button type="submit" class="botao-secundario">Confirmar perda</button></form></details>
    </section>`
    : html`<section class="cartao acoes-lead"><p>${l.etapa === "Contratado"
        ? html`<span class="selo selo-ganho">Contratado</span> Convertido no cliente <a href="/sistema/clientes/${String(l.cliente_id)}">${l.cliente_nome || "ver cliente"}</a>.`
        : html`<span class="selo selo-perdido">Perdido</span> ${l.motivo_perda ? `Motivo: ${l.motivo_perda}.` : ""}`}</p>
      ${l.etapa === "Perdido" ? html`<form method="post" action="/sistema/crm/leads/${String(l.id)}/reabrir" class="form-linha">${campoCsrf(sessao)}<button type="submit" class="botao-secundario">Reabrir no funil</button></form>` : ""}</section>`;
  return resposta(pagina({
    titulo: l.nome, sessao, ...mensagem(req),
    corpo: html`<p class="trilha"><a href="/sistema/crm">Funil de prospecção</a></p>
      <div class="titulo-acoes"><h1>${l.nome} <span class="${`selo ${l.etapa === "Contratado" ? "selo-ganho" : l.etapa === "Perdido" ? "selo-perdido" : "selo-lead"}`}">${l.etapa}</span></h1>
        <span class="botoes-titulo">${fone.length >= 10 ? html`<a class="botao-link botao-secundario" href="https://wa.me/55${fone}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ""}
        <a class="botao-link botao-secundario" href="/sistema/crm/leads/${String(l.id)}/editar">Editar</a></span></div>
      ${acoes}
      <section class="cartao"><dl class="ficha">
        ${campo("Tipo", l.tipo)}${campo("Telefone", telefone)}${campo("E-mail", email)}${campo("Área de interesse", l.area)}
        ${campo("Origem", l.origem)}${campo("Indicado por", l.indicado_por)}${campo("Honorários estimados", l.valor_estimado ? moeda(l.valor_estimado) : "")}
        ${campo("Responsável", l.responsavel)}${campo("Cadastrado em", new Date((l.criado_em - 3 * 3600) * 1000).toISOString().slice(0, 10).split("-").reverse().join("/"))}
      </dl>${chips(l.etiquetas)}${resumo ? html`<h3>Resumo do caso</h3><p class="pre">${resumo}</p>` : ""}</section>
      ${await blocoRelacionamento(env, sessao, { leadId: l.id, voltar })}`,
  }));
}

// ---------- Ações do lead ----------
export async function acaoLead(req, env, sessao, id, acao) {
  const lid = Number(id);
  const l = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(lid).first();
  if (acao === "etapa" && (req.headers.get("Accept") || "").includes("application/json")) {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return json({ ok: false, mensagem: "Sessão expirada. Recarregue a página." }, 403);
    const etapa = txt(f, "etapa", 40);
    if (!l || !ETAPAS.includes(l.etapa)) return json({ ok: false, mensagem: "Lead não encontrado no funil." }, 404);
    if (!ETAPAS.includes(etapa)) return json({ ok: false, mensagem: "Etapa inválida." }, 400);
    if (etapa !== l.etapa) {
      await env.DB.prepare("UPDATE leads SET etapa = ?, etapa_desde = ?, atualizado_em = ? WHERE id = ?").bind(etapa, agora(), agora(), lid).run();
      await auditar(env, req, sessao.usuario_id, "lead_etapa", `lead ${lid}: ${l.etapa} → ${etapa}`);
    }
    return json({ ok: true, mensagem: `${l.nome}: ${etapa}.` });
  }
  if (!l) return naoEncontrado(sessao);
  const volta = (msg) => redirecionar(`/sistema/crm/leads/${lid}?msg=${msg}`);
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return volta("sessao");
  const t = agora();
  if (acao === "etapa") {
    const etapa = txt(f, "etapa", 40);
    if (!ETAPAS.includes(etapa) || !ETAPAS.includes(l.etapa)) return volta("dados");
    if (etapa !== l.etapa) {
      await env.DB.prepare("UPDATE leads SET etapa = ?, etapa_desde = ?, atualizado_em = ? WHERE id = ?").bind(etapa, t, t, lid).run();
      await auditar(env, req, sessao.usuario_id, "lead_etapa", `lead ${lid}: ${l.etapa} → ${etapa}`);
    }
    return volta("etapa");
  }
  if (acao === "perder") {
    const motivo = txt(f, "motivo", 100);
    if (!motivo) return volta("motivo");
    if (!ETAPAS.includes(l.etapa)) return volta("dados");
    await env.DB.prepare("UPDATE leads SET etapa = 'Perdido', motivo_perda = ?, encerrado_em = ?, etapa_desde = ?, atualizado_em = ? WHERE id = ?").bind(motivo, t, t, t, lid).run();
    await env.DB.prepare("UPDATE crm_tarefas SET feito = 1, concluido_em = ? WHERE lead_id = ? AND feito = 0").bind(t, lid).run();
    await auditar(env, req, sessao.usuario_id, "lead_perdido", `lead ${lid}: ${motivo}`);
    return volta("perdido");
  }
  if (acao === "reabrir") {
    if (l.etapa !== "Perdido") return volta("dados");
    await env.DB.prepare("UPDATE leads SET etapa = ?, motivo_perda = NULL, encerrado_em = NULL, etapa_desde = ?, atualizado_em = ? WHERE id = ?").bind(ETAPAS[0], t, t, lid).run();
    await auditar(env, req, sessao.usuario_id, "lead_reaberto", `lead ${lid}`);
    return volta("reaberto");
  }
  if (acao === "converter") {
    if (!ETAPAS.includes(l.etapa)) return volta("dados");
    // Cria o cliente com o que já se sabe; contatos continuam cifrados. Interações e follow-ups passam a aparecer na ficha do cliente.
    const r = await env.DB.prepare(`INSERT INTO clientes (nome, tipo, email_enc, telefone_enc, observacoes_enc, origem, etiquetas, data_cadastro, criado_em, atualizado_em, editado_local)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1)`).bind(l.nome, l.tipo, l.email_enc, l.telefone_enc, l.resumo_enc,
      l.origem, l.etiquetas, hojeBR(), t).run();
    const cid = r.meta.last_row_id;
    await env.DB.batch([
      env.DB.prepare("UPDATE leads SET etapa = 'Contratado', cliente_id = ?, encerrado_em = ?, etapa_desde = ?, atualizado_em = ? WHERE id = ?").bind(cid, t, t, t, lid),
      env.DB.prepare("UPDATE crm_interacoes SET cliente_id = ? WHERE lead_id = ?").bind(cid, lid),
      env.DB.prepare("UPDATE crm_tarefas SET cliente_id = ? WHERE lead_id = ?").bind(cid, lid),
    ]);
    await auditar(env, req, sessao.usuario_id, "lead_convertido", `lead ${lid} → cliente ${cid}`);
    return redirecionar(`/sistema/clientes/${cid}/editar?convertido=1`);
  }
  if (acao === "excluir") {
    if (sessao.perfil !== "admin" || f.get("confirmar") !== "1") return volta("dados");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM crm_interacoes WHERE lead_id = ? AND cliente_id IS NULL").bind(lid),
      env.DB.prepare("DELETE FROM crm_tarefas WHERE lead_id = ? AND cliente_id IS NULL").bind(lid),
      env.DB.prepare("UPDATE crm_interacoes SET lead_id = NULL WHERE lead_id = ?").bind(lid),
      env.DB.prepare("UPDATE crm_tarefas SET lead_id = NULL WHERE lead_id = ?").bind(lid),
      env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(lid),
    ]);
    await auditar(env, req, sessao.usuario_id, "lead_excluido", `lead ${lid}`);
    return redirecionar("/sistema/crm?msg=excluido");
  }
  return naoEncontrado(sessao);
}

// ---------- Interações e follow-ups ----------
async function alvoValido(env, f) {
  const leadId = Number(f.get("lead_id")) || null, clienteId = Number(f.get("cliente_id")) || null;
  if (leadId && await env.DB.prepare("SELECT 1 FROM leads WHERE id = ?").bind(leadId).first()) return { leadId, clienteId: null };
  if (clienteId && await env.DB.prepare("SELECT 1 FROM clientes WHERE id = ?").bind(clienteId).first()) return { leadId: null, clienteId };
  return null;
}

export async function novaInteracao(req, env, sessao) {
  const { f, ok } = await csrfOk(req, sessao);
  const voltar = destinoSeguro(f.get("voltar"), "/sistema/crm");
  if (!ok) return redirecionar(comMsg(voltar, "sessao"));
  const alvo = await alvoValido(env, f);
  const tipo = txt(f, "tipo", 60), data = dataValida(txt(f, "data")), resumo = txt(f, "resumo", 4000);
  if (!alvo || !tipo || !data || !resumo || data > hojeBR()) return redirecionar(comMsg(`${voltar}#interacoes`, "dados"));
  await env.DB.prepare("INSERT INTO crm_interacoes (lead_id, cliente_id, tipo, data, resumo_enc, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(alvo.leadId, alvo.clienteId, tipo, data, await cifrar(env, resumo), sessao.usuario_id, agora()).run();
  if (alvo.leadId) await env.DB.prepare("UPDATE leads SET atualizado_em = ? WHERE id = ?").bind(agora(), alvo.leadId).run();
  await auditar(env, req, sessao.usuario_id, "crm_interacao", alvo.leadId ? `lead ${alvo.leadId}` : `cliente ${alvo.clienteId}`);
  return redirecionar(comMsg(`${voltar}#interacoes`, "interacao"));
}

// Edição de uma interação (autor ou administrador). Excluir: só administradores, com confirmação.
export async function editarInteracao(req, env, sessao, id) {
  const i = await env.DB.prepare("SELECT i.*, l.nome AS lead_nome, c.nome AS cliente_nome FROM crm_interacoes i LEFT JOIN leads l ON l.id = i.lead_id LEFT JOIN clientes c ON c.id = i.cliente_id WHERE i.id = ?").bind(Number(id)).first();
  if (!i) return naoEncontrado(sessao);
  const padrao = i.cliente_id ? `/sistema/clientes/${i.cliente_id}` : `/sistema/crm/leads/${i.lead_id}`;
  if (i.usuario_id !== sessao.usuario_id && sessao.perfil !== "admin") return redirecionar(comMsg(`${padrao}#interacoes`, "dados"));
  const ls = await obterListas(env, ["tipo_interacao"]);
  const hoje = hojeBR();
  const tela = (v, voltar, erro) => resposta(pagina({
    titulo: "Editar interação", sessao, erro,
    corpo: html`<p class="trilha"><a href="${voltar}#interacoes">Voltar a ${i.cliente_nome || i.lead_nome || "ficha"}</a></p><h1>Editar interação</h1>
      <section class="cartao"><form method="post" class="formulario grade-form">${campoCsrf(sessao)}<input type="hidden" name="voltar" value="${voltar}">
        <label>Tipo<select name="tipo" required>${opcoes(comAtual(ls.tipo_interacao, v.tipo), v.tipo, "Selecione…")}</select></label>
        <label>Data<input type="date" name="data" required value="${v.data}" max="${hoje}"></label>
        <label class="largo">Anotação<textarea name="resumo" rows="6" maxlength="4000" required>${v.resumo || ""}</textarea></label>
        <div class="largo botoes-form"><button type="submit">Salvar</button><a class="botao-link botao-secundario" href="${voltar}#interacoes">Cancelar</a></div>
      </form>
      ${sessao.perfil === "admin" ? html`<form method="post" action="/sistema/crm/interacoes/${String(i.id)}/excluir" class="form-excluir-andamento"
          data-confirmar="Excluir esta interação? Esta ação não pode ser desfeita.">${campoCsrf(sessao)}<input type="hidden" name="voltar" value="${voltar}">
          <input type="hidden" name="confirmar" value="1"><button type="submit" class="botao-perigo">Excluir interação</button></form>` : ""}</section>
      <script src="/assets/js/confirmar.js" defer></script>`,
  }));
  if (req.method === "GET") return tela({ tipo: i.tipo, data: i.data, resumo: await decifrar(env, i.resumo_enc) }, destinoSeguro(new URL(req.url).searchParams.get("voltar"), padrao));
  const { f, ok } = await csrfOk(req, sessao);
  const voltar = destinoSeguro(f.get("voltar"), padrao);
  const v = { tipo: txt(f, "tipo", 60), data: dataValida(txt(f, "data")), resumo: txt(f, "resumo", 4000) };
  if (!ok) return tela(v, voltar, "Sessão expirada. Tente novamente.");
  if (!v.tipo || !v.data || !v.resumo || v.data > hoje) return tela({ ...v, data: v.data || i.data }, voltar, "Preencha tipo, data (até hoje) e anotação.");
  await env.DB.prepare("UPDATE crm_interacoes SET tipo = ?, data = ?, resumo_enc = ? WHERE id = ?").bind(v.tipo, v.data, await cifrar(env, v.resumo), i.id).run();
  await auditar(env, req, sessao.usuario_id, "crm_interacao_alterada", `interação ${i.id}`);
  return redirecionar(comMsg(`${voltar}#interacoes`, "salvo"));
}

export async function excluirInteracao(req, env, sessao, id) {
  const { f, ok } = await csrfOk(req, sessao);
  const voltar = destinoSeguro(f.get("voltar"), "/sistema/crm");
  if (!ok) return redirecionar(comMsg(voltar, "sessao"));
  const i = await env.DB.prepare("SELECT * FROM crm_interacoes WHERE id = ?").bind(Number(id)).first();
  if (sessao.perfil !== "admin") return redirecionar(comMsg(`${voltar}#interacoes`, "permissao"));
  if (!i || f.get("confirmar") !== "1") return redirecionar(comMsg(`${voltar}#interacoes`, "dados"));
  await env.DB.prepare("DELETE FROM crm_interacoes WHERE id = ?").bind(i.id).run();
  await auditar(env, req, sessao.usuario_id, "crm_interacao_excluida", `interação ${i.id}`);
  return redirecionar(comMsg(`${voltar}#interacoes`, "excluida"));
}

export async function novaTarefa(req, env, sessao) {
  const { f, ok } = await csrfOk(req, sessao);
  const voltar = destinoSeguro(f.get("voltar"), "/sistema/crm");
  if (!ok) return redirecionar(comMsg(voltar, "sessao"));
  const alvo = await alvoValido(env, f);
  const titulo = txt(f, "titulo", 200), data = dataValida(txt(f, "data")), responsavel = txt(f, "responsavel", 100);
  if (!alvo || !titulo || !data) return redirecionar(comMsg(`${voltar}#followups`, "dados"));
  await env.DB.prepare("INSERT INTO crm_tarefas (lead_id, cliente_id, titulo, data, responsavel, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(alvo.leadId, alvo.clienteId, titulo, data, responsavel, sessao.usuario_id, agora()).run();
  if (alvo.leadId) await env.DB.prepare("UPDATE leads SET atualizado_em = ? WHERE id = ?").bind(agora(), alvo.leadId).run();
  if (responsavel) {
    const nome = (await env.DB.prepare(alvo.leadId ? "SELECT nome FROM leads WHERE id = ?" : "SELECT nome FROM clientes WHERE id = ?").bind(alvo.leadId || alvo.clienteId).first())?.nome || "";
    await notificar(env, { destinos: await idsPorNome(env, responsavel), tipo: "followup", autorId: sessao.usuario_id,
      link: alvo.leadId ? `/sistema/crm/leads/${alvo.leadId}#followups` : `/sistema/clientes/${alvo.clienteId}#followups`,
      texto: `Follow-up para você em ${dataBR(data)}: ${titulo} · ${nome} (por ${sessao.nome.split(" ")[0]})` });
  }
  await auditar(env, req, sessao.usuario_id, "crm_followup", alvo.leadId ? `lead ${alvo.leadId}` : `cliente ${alvo.clienteId}`);
  return redirecionar(comMsg(`${voltar}#followups`, "tarefa"));
}

export async function concluirTarefa(req, env, sessao, id) {
  const { f, ok } = await csrfOk(req, sessao);
  const voltar = destinoSeguro(f.get("voltar"), "/sistema/crm?visao=followups");
  if (!ok) return redirecionar(comMsg(voltar, "sessao"));
  const tf = await env.DB.prepare("SELECT id, feito FROM crm_tarefas WHERE id = ?").bind(Number(id)).first();
  if (!tf) return redirecionar(comMsg(voltar, "dados"));
  await env.DB.prepare("UPDATE crm_tarefas SET feito = ?, concluido_em = ? WHERE id = ?").bind(tf.feito ? 0 : 1, tf.feito ? null : agora(), tf.id).run();
  await auditar(env, req, sessao.usuario_id, tf.feito ? "crm_followup_reaberto" : "crm_followup_feito", `follow-up ${tf.id}`);
  return redirecionar(comMsg(voltar.includes("/sistema/crm?") ? voltar : `${voltar}#followups`, "concluida"));
}

// Follow-ups pendentes para o painel (atrasados, hoje e próximos 7 dias).
export async function followupsPainel(env) {
  const hoje = hojeBR();
  const { results } = await env.DB.prepare(`SELECT t.id, t.titulo, t.data, t.responsavel, t.lead_id, t.cliente_id, l.nome AS lead_nome, c.nome AS cliente_nome
      FROM crm_tarefas t LEFT JOIN leads l ON l.id = t.lead_id LEFT JOIN clientes c ON c.id = t.cliente_id
      WHERE t.feito = 0 AND t.data <= ? ORDER BY t.data, t.id LIMIT 8`).bind(somarDias(hoje, 7)).all();
  return { itens: results, hoje };
}
