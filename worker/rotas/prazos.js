// Prazos: lista, cadastro, edição, cálculo e cumprimento.
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { calendarioDoBanco, hojeBR, somarDias } from "../calendario.js";
import { opcoes, listasApoio, csrfOk, txt, dataValida, urgencia, rotuloProcesso, dataBR } from "./comum.js";

const SITUACOES = [["aberto", "Aberto"], ["cumprido", "Cumprido"], ["cancelado", "Cancelado"]];
const CONTAGENS = [["uteis", "Dias úteis"], ["corridos", "Dias corridos"]];

// Formulário de prazo, reaproveitado na triagem de intimações.
export function formularioPrazo({ sessao, p = {}, apoio, acao, calculo = null, extraTopo = "", botaoSalvar = "Salvar prazo", extraBotoes = "" }) {
  return html`<form method="post" action="${acao}" class="formulario grade-form">
    ${campoCsrf(sessao)}${extraTopo}
    <label class="largo">Processo<select name="processo_id">${opcoes(apoio.processos, p.processo_id, "Sem processo vinculado")}</select></label>
    <label class="largo">Título<input name="titulo" required maxlength="200" value="${p.titulo || ""}" placeholder="Ex.: Contestação, Réplica, Recurso de apelação"></label>
    <label>Tipo<input name="tipo" maxlength="100" value="${p.tipo || ""}" list="tipos-prazo"></label>
    <label>Responsável<select name="responsavel">${opcoes(apoio.responsaveis, p.responsavel)}</select></label>
    <fieldset class="largo calculo">
      <legend>Cálculo</legend>
      <label>Data da publicação/intimação<input type="date" name="data_inicio" value="${p.data_inicio || ""}"></label>
      <label>Prazo (dias)<input type="number" name="dias" min="1" max="365" value="${p.dias ?? ""}"></label>
      <label>Contagem<select name="contagem">${opcoes(CONTAGENS, p.contagem || "uteis", "Dias úteis")}</select></label>
      <label>Prazo interno (dias úteis antes)<input type="number" name="antecedencia" min="0" max="30" value="${p.antecedencia ?? 2}"></label>
      <button type="submit" name="acao" value="calcular" class="botao-secundario" formnovalidate>Calcular datas</button>
      ${calculo ? html`<p class="resultado-calculo">Prazo fatal: <strong>${dataBR(calculo.fatal)}</strong> · Prazo interno: <strong>${dataBR(calculo.interno)}</strong>
        <br><small>Considera dias úteis, feriados nacionais e os cadastrados, e o recesso de 20/12 a 20/01. Confira antes de salvar.</small></p>` : ""}
    </fieldset>
    <label>Prazo fatal<input type="date" name="prazo_fatal" value="${p.prazo_fatal || ""}"></label>
    <label>Prazo interno<input type="date" name="prazo_interno" value="${p.prazo_interno || ""}"></label>
    <label>Hora<input type="time" name="hora" value="${p.hora || ""}"></label>
    <label>Situação<select name="situacao">${opcoes(SITUACOES, p.situacao || "aberto", "Aberto")}</select></label>
    <label>Data de cumprimento<input type="date" name="data_cumprimento" value="${p.data_cumprimento || ""}"></label>
    <label>Audiência (data)<input type="date" name="data_audiencia" value="${p.data_audiencia || ""}"></label>
    <label>Audiência (hora)<input type="time" name="hora_audiencia" value="${p.hora_audiencia || ""}"></label>
    <label class="largo">Descrição<textarea name="descricao" rows="3" maxlength="4000">${p.descricao || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit" name="acao" value="salvar">${botaoSalvar}</button>${extraBotoes}</div>
    <datalist id="tipos-prazo"><option value="Manifestação"><option value="Contestação"><option value="Réplica"><option value="Recurso"><option value="Contrarrazões"><option value="Embargos de declaração"><option value="Audiência"><option value="Cumprimento de sentença"></datalist>
  </form>`;
}

// Lê o formulário; se pedido (ou se faltar a data fatal), calcula as datas.
export async function lerPrazo(env, f) {
  const p = {
    processo_id: Number(f.get("processo_id")) || null,
    titulo: txt(f, "titulo", 200), tipo: txt(f, "tipo", 100), responsavel: txt(f, "responsavel", 120),
    data_inicio: dataValida(txt(f, "data_inicio")), dias: Number(f.get("dias")) || null,
    contagem: f.get("contagem") === "corridos" ? "corridos" : "uteis",
    antecedencia: Math.max(0, Math.min(30, Number(f.get("antecedencia") ?? 2) || 0)),
    prazo_fatal: dataValida(txt(f, "prazo_fatal")), prazo_interno: dataValida(txt(f, "prazo_interno")),
    hora: txt(f, "hora", 10), situacao: ["aberto", "cumprido", "cancelado"].includes(f.get("situacao")) ? f.get("situacao") : "aberto",
    data_cumprimento: dataValida(txt(f, "data_cumprimento")), data_audiencia: dataValida(txt(f, "data_audiencia")),
    hora_audiencia: txt(f, "hora_audiencia", 10), descricao: txt(f, "descricao", 4000),
  };
  let calculo = null;
  const querCalcular = f.get("acao") === "calcular" || (!p.prazo_fatal && p.data_inicio && p.dias);
  if (querCalcular && p.data_inicio && p.dias) {
    calculo = (await calendarioDoBanco(env)).calcular({ dataInicial: p.data_inicio, dias: p.dias, contagem: p.contagem, antecedencia: p.antecedencia });
    if (calculo) { p.prazo_fatal = calculo.fatal; p.prazo_interno = calculo.interno; }
  }
  if (p.situacao === "cumprido" && !p.data_cumprimento) p.data_cumprimento = hojeBR();
  return { p, calculo };
}

export async function gravarPrazo(env, p, { id = null, usuarioId, publicacaoId = null }) {
  const t = agora();
  const v = [p.processo_id, p.titulo, p.tipo, p.descricao, p.data_inicio, p.dias, p.contagem, p.prazo_fatal, p.prazo_interno,
    p.hora, p.responsavel, p.situacao, p.data_cumprimento, p.data_audiencia, p.hora_audiencia, t];
  if (id) {
    await env.DB.prepare(`UPDATE prazos SET processo_id=?1, titulo=?2, tipo=?3, descricao=?4, data_inicio=?5, dias=?6, contagem=?7,
      prazo_fatal=?8, prazo_interno=?9, hora=?10, responsavel=?11, situacao=?12, data_cumprimento=?13, data_audiencia=?14,
      hora_audiencia=?15, atualizado_em=?16 WHERE id=?17`).bind(...v, id).run();
    return id;
  }
  const r = await env.DB.prepare(`INSERT INTO prazos (processo_id, titulo, tipo, descricao, data_inicio, dias, contagem, prazo_fatal,
    prazo_interno, hora, responsavel, situacao, data_cumprimento, data_audiencia, hora_audiencia, atualizado_em, criado_em, criado_por, publicacao_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16,?17,?18)`).bind(...v, usuarioId, publicacaoId).run();
  return r.meta.last_row_id;
}

export async function prazos(req, env, sessao, id) {
  // ---------- Lista ----------
  if (!id && req.method === "GET") {
    const sp = new URL(req.url).searchParams;
    const visao = sp.get("visao") || "abertos";
    const hoje = hojeBR();
    const filtros = {
      abertos: ["p.situacao = 'aberto'", []],
      vencidos: ["p.situacao = 'aberto' AND p.prazo_fatal < ?", [hoje]],
      semana: ["p.situacao = 'aberto' AND p.prazo_fatal BETWEEN ? AND ?", [hoje, somarDias(hoje, 7)]],
      cumpridos: ["p.situacao = 'cumprido'", []],
      todos: ["1 = 1", []],
    };
    const [onde, args] = filtros[visao] || filtros.abertos;
    const ordem = visao === "cumpridos" ? "p.data_cumprimento DESC" : "p.prazo_fatal ASC";
    const { results } = await env.DB.prepare(`SELECT p.*, pr.pasta, pr.numero FROM prazos p LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE ${onde} ORDER BY ${ordem} LIMIT 500`).bind(...args).all();
    const aba = (v, r) => html`<a href="/sistema/prazos?visao=${v}" class="${visao === v ? "ativa" : ""}">${r}</a>`;
    return resposta(pagina({
      titulo: "Prazos", sessao,
      corpo: html`
        <div class="titulo-acoes"><h1>Prazos</h1><a class="botao-link" href="/sistema/prazos/novo">Novo prazo</a></div>
        <nav class="abas">${aba("abertos", "Abertos")}${aba("vencidos", "Vencidos")}${aba("semana", "Próximos 7 dias")}${aba("cumpridos", "Cumpridos")}${aba("todos", "Todos")}</nav>
        <div class="tabela-rolagem"><table>
          <thead><tr><th>Fatal</th><th>Interno</th><th>Prazo</th><th>Processo</th><th>Responsável</th><th></th></tr></thead>
          <tbody>${results.map((p) => html`<tr>
            <td class="nowrap">${dataBR(p.prazo_fatal)} ${urgencia(p.prazo_fatal, p.situacao)}</td>
            <td class="nowrap">${dataBR(p.prazo_interno)}</td>
            <td><a href="/sistema/prazos/${String(p.id)}">${p.titulo}</a>${p.tipo ? html`<br><small>${p.tipo}</small>` : ""}</td>
            <td>${p.processo_id ? html`<a href="/sistema/processos/${String(p.processo_id)}">${rotuloProcesso(p)}</a>` : "—"}</td>
            <td>${p.responsavel}</td>
            <td>${p.situacao === "aberto" ? html`<form method="post" action="/sistema/prazos/${String(p.id)}/cumprir" class="form-linha">${campoCsrf(sessao)}<button class="botao-pequeno" type="submit">Cumprido</button></form>` : html`<small>${p.situacao === "cumprido" ? `Cumprido ${dataBR(p.data_cumprimento)}` : "Cancelado"}</small>`}</td>
          </tr>`)}</tbody>
        </table></div>
        <p class="dica">${String(results.length)} prazo(s).</p>`,
    }));
  }

  // ---------- Cumprir (ação rápida da lista) ----------
  if (id && id.endsWith("/cumprir") && req.method === "POST") {
    const { ok } = await csrfOk(req, sessao);
    const pid = Number(id.split("/")[0]);
    if (ok) {
      await env.DB.prepare("UPDATE prazos SET situacao = 'cumprido', data_cumprimento = ?, atualizado_em = ? WHERE id = ? AND situacao = 'aberto'")
        .bind(hojeBR(), agora(), pid).run();
      await auditar(env, req, sessao.usuario_id, "prazo_cumprido", `prazo ${pid}`);
    }
    return redirecionar(req.headers.get("Referer")?.includes("/sistema/") ? new URL(req.headers.get("Referer")).pathname + new URL(req.headers.get("Referer")).search : "/sistema/prazos");
  }

  // ---------- Novo / editar ----------
  const novo = id === "novo";
  const existente = novo ? null : await env.DB.prepare("SELECT * FROM prazos WHERE id = ?").bind(Number(id)).first();
  if (!novo && !existente) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Prazo não encontrado</h1>` }), 404);
  const apoio = await listasApoio(env);
  const acao = novo ? "/sistema/prazos/novo" : `/sistema/prazos/${id}`;
  const tela = (p, { erro, aviso, calculo } = {}) => resposta(pagina({
    titulo: novo ? "Novo prazo" : p.titulo, sessao, erro, aviso,
    corpo: html`<p class="trilha"><a href="/sistema/prazos">Prazos</a></p>
      <h1>${novo ? "Novo prazo" : p.titulo}</h1>
      ${existente?.publicacao_id ? html`<p class="subtitulo">Criado a partir de <a href="/sistema/publicacoes/${String(existente.publicacao_id)}">intimação do DJEN</a></p>` : ""}
      <section class="cartao">${formularioPrazo({ sessao, p, apoio, acao, calculo })}</section>`,
  }));

  if (req.method === "GET") {
    const sp = new URL(req.url).searchParams;
    return tela(existente || { processo_id: Number(sp.get("processo")) || null, situacao: "aberto", contagem: "uteis" }, sp.get("salvo") ? { aviso: "Prazo salvo." } : {});
  }
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return tela(existente || {}, { erro: "Sessão expirada. Tente novamente." });
  const { p, calculo } = await lerPrazo(env, f);
  if (f.get("acao") === "calcular") return tela(p, calculo ? { calculo } : { erro: "Para calcular, informe a data da publicação e o número de dias." });
  if (!p.titulo || !p.prazo_fatal) return tela(p, { erro: "Informe o título e o prazo fatal (ou a data da publicação e os dias para calcular)." });
  const novoId = await gravarPrazo(env, p, { id: novo ? null : existente.id, usuarioId: sessao.usuario_id });
  await auditar(env, req, sessao.usuario_id, novo ? "prazo_criado" : "prazo_alterado", `prazo ${novoId}`);
  return redirecionar(`/sistema/prazos/${novoId}?salvo=1`);
}
