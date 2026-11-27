// Prazos: lista, cadastro, edição, cálculo e cumprimento.
import { salvarAnexo, excluirAnexo } from "../anexos.js";
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { calendarioDoBanco, hojeBR, somarDias } from "../calendario.js";
import { prazosPadrao } from "../listas.js";
import { notificar, idsPorNome, idsPorPerfil } from "../notificacoes.js";
import { visualizarPrazo, acaoVisualizacao } from "./prazo-visualizar.js";
import { seguro, h } from "../html.js";
import { opcoes, listasApoio, csrfOk, txt, dataValida, urgencia, rotuloProcesso, dataBR, descricaoDaIntimacao, cabecalhoAgenda, dataTravada } from "./comum.js";

const SITUACOES = [["aberto", "Aberto"], ["cumprido", "Cumprido"], ["cancelado", "Cancelado"]];
const CONTAGENS = [["uteis", "Dias úteis"], ["corridos", "Dias corridos"]];
const CATEGORIAS = [["Prazo", "Prazo"], ["Compromisso", "Compromisso"]];
export const ehCompromisso = (p) => p?.categoria === "Compromisso";

// Opções do campo Tipo conforme a categoria (valor antigo fora da lista continua selecionável).
function opcoesTipo(p, tipos) {
  const lista = tipos[p.categoria === "Compromisso" ? "Compromisso" : "Prazo"] || [];
  const extra = p.tipo && !lista.includes(p.tipo) ? [p.tipo] : [];
  return seguro(`<option value="">Selecione…</option>` + [...extra, ...lista].map((t) =>
    `<option value="${h(t)}"${t === p.tipo ? " selected" : ""}>${h(t)}${extra.includes(t) ? " (registro antigo)" : ""}</option>`).join(""));
}

// Formulário de agendamento (prazo ou compromisso), reaproveitado na triagem de intimações.
export function formularioPrazo({ sessao, p = {}, apoio, acao, calculo = null, extraTopo = "", botaoSalvar = "Salvar", extraBotoes = "" }) {
  return html`<form method="post" action="${acao}" class="formulario grade-form form-agendamento${p.categoria === "Compromisso" ? " form-compromisso" : ""}">
    ${campoCsrf(sessao)}${extraTopo}
    <label>Categoria<select name="categoria" data-categoria>${seguro(CATEGORIAS.map(([v, r]) => `<option value="${v}"${(p.categoria || "Prazo") === v ? " selected" : ""}>${r}</option>`).join(""))}</select></label>
    <label>Tipo<select name="tipo" required data-tipos-prazo="${JSON.stringify(apoio.tipos.Prazo)}" data-tipos-compromisso="${JSON.stringify(apoio.tipos.Compromisso)}" data-padroes="${JSON.stringify(apoio.padroes || {})}">${opcoesTipo(p, apoio.tipos)}</select></label>
    <label class="duplo">Processo<select name="processo_id">${opcoes(apoio.processos, p.processo_id, "Sem processo vinculado")}</select></label>
    <label class="largo">Título <small>(opcional; se vazio, usa o tipo)</small><input name="titulo" maxlength="200" value="${p.titulo && p.titulo !== p.tipo ? p.titulo : ""}" placeholder="Ex.: Réplica à contestação da seguradora"></label>
    <label>Responsável<select name="responsavel">${opcoes(apoio.responsaveis, p.responsavel)}</select></label>
    <fieldset class="largo calculo">
      <legend>Cálculo</legend>
      <label>Data da publicação/intimação<input type="date" name="data_inicio" value="${p.data_inicio || ""}"></label>
      <label>Prazo (dias)<input type="number" name="dias" min="1" max="365" value="${p.dias ?? ""}"><small class="dica-padrao" data-dica-padrao></small></label>
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
    <label class="largo">Descrição<textarea name="descricao" rows="${String(Math.min(16, Math.max(3, String(p.descricao || "").split("\n").length + 1)))}" maxlength="20000">${p.descricao || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit" name="acao" value="salvar">${botaoSalvar}</button>${extraBotoes}</div>
    <script src="/assets/js/agendamento.js" defer></script>
  </form>`;
}

// Lê o formulário; se pedido (ou se faltar a data fatal), calcula as datas.
export async function lerPrazo(env, f) {
  const p = {
    processo_id: Number(f.get("processo_id")) || null,
    titulo: txt(f, "titulo", 200) || txt(f, "tipo", 100), tipo: txt(f, "tipo", 100), responsavel: txt(f, "responsavel", 120),
    categoria: f.get("categoria") === "Compromisso" ? "Compromisso" : "Prazo",
    data_inicio: dataValida(txt(f, "data_inicio")), dias: Number(f.get("dias")) || null,
    contagem: f.get("contagem") === "corridos" ? "corridos" : "uteis",
    antecedencia: Math.max(0, Math.min(30, Number(f.get("antecedencia") ?? 2) || 0)),
    prazo_fatal: dataValida(txt(f, "prazo_fatal")), prazo_interno: dataValida(txt(f, "prazo_interno")),
    hora: txt(f, "hora", 10), situacao: ["aberto", "cumprido", "cancelado"].includes(f.get("situacao")) ? f.get("situacao") : "aberto",
    data_cumprimento: dataValida(txt(f, "data_cumprimento")), data_audiencia: dataValida(txt(f, "data_audiencia")),
    hora_audiencia: txt(f, "hora_audiencia", 10), descricao: txt(f, "descricao", 20000),
  };
  if (!p.dias && p.tipo && p.categoria !== "Compromisso") {
    const pad = (await prazosPadrao(env))[p.tipo];
    if (pad) { p.dias = pad.dias; p.contagem = f.get("contagem") ? p.contagem : pad.contagem; }
  }
  let calculo = null;
  const querCalcular = f.get("acao") === "calcular" || (!p.prazo_fatal && p.data_inicio && p.dias);
  if (querCalcular && p.data_inicio && p.dias) {
    calculo = (await calendarioDoBanco(env)).calcular({ dataInicial: p.data_inicio, dias: p.dias, contagem: p.contagem, antecedencia: p.antecedencia });
    if (calculo) { p.prazo_fatal = calculo.fatal; p.prazo_interno = calculo.interno; }
  }
  if (p.situacao === "cumprido" && !p.data_cumprimento) p.data_cumprimento = hojeBR();
  return { p, calculo };
}

// Avisa o responsável (e os administradores, em prazos novos) quando outra pessoa cadastra ou atribui o prazo.
async function avisarPrazo(env, p, id, usuarioId, novo) {
  const destinos = [...await idsPorNome(env, p.responsavel), ...(novo ? await idsPorPerfil(env, ["admin"]) : [])];
  const proc = p.processo_id ? await env.DB.prepare("SELECT pasta FROM processos WHERE id = ?").bind(p.processo_id).first() : null;
  const autor = await env.DB.prepare("SELECT nome FROM usuarios WHERE id = ?").bind(usuarioId).first();
  const tipo = p.categoria === "Compromisso" ? "Compromisso" : "Prazo";
  const quando = p.categoria === "Compromisso" ? dataBR(p.prazo_interno || p.prazo_fatal) : `fatal ${dataBR(p.prazo_fatal)}`;
  const texto = `${novo ? `Novo ${tipo.toLowerCase()}` : `${tipo} atribuído a você`}: ${p.titulo}${proc?.pasta ? ` · Pasta ${proc.pasta}` : ""} · ${quando}${autor ? ` (por ${autor.nome.split(" ")[0]})` : ""}`;
  await notificar(env, { destinos, tipo: "prazo", texto, link: `/sistema/prazos/${id}`, autorId: usuarioId });
}

export async function gravarPrazo(env, p, { id = null, usuarioId, publicacaoId = null }) {
  const t = agora();
  const anterior = id ? await env.DB.prepare("SELECT responsavel FROM prazos WHERE id = ?").bind(id).first() : null;
  const v = [p.processo_id, p.titulo, p.tipo, p.descricao, p.data_inicio, p.dias, p.contagem, p.prazo_fatal, p.prazo_interno,
    p.hora, p.responsavel, p.situacao, p.data_cumprimento, p.data_audiencia, p.hora_audiencia, t, p.categoria || "Prazo"];
  if (id) {
    await env.DB.prepare(`UPDATE prazos SET processo_id=?1, titulo=?2, tipo=?3, descricao=?4, data_inicio=?5, dias=?6, contagem=?7,
      prazo_fatal=?8, prazo_interno=?9, hora=?10, responsavel=?11, situacao=?12, data_cumprimento=?13, data_audiencia=?14,
      hora_audiencia=?15, atualizado_em=?16, categoria=?17 WHERE id=?18`).bind(...v, id).run();
    if (p.responsavel && p.responsavel !== anterior?.responsavel) await avisarPrazo(env, p, id, usuarioId, false);
    return id;
  }
  const r = await env.DB.prepare(`INSERT INTO prazos (processo_id, titulo, tipo, descricao, data_inicio, dias, contagem, prazo_fatal,
    prazo_interno, hora, responsavel, situacao, data_cumprimento, data_audiencia, hora_audiencia, atualizado_em, categoria, criado_em, criado_por, publicacao_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?16,?18,?19)`).bind(...v, usuarioId, publicacaoId).run();
  await avisarPrazo(env, p, r.meta.last_row_id, usuarioId, true);
  return r.meta.last_row_id;
}

// Aba "Prazos" da Agenda.
export async function listaPrazos(req, env, sessao) {
    const sp = new URL(req.url).searchParams;
    const visao = sp.get("filtro") || "abertos";
    const hoje = hojeBR();
    const filtros = {
      abertos: ["p.situacao = 'aberto'", []],
      vencidos: ["p.situacao = 'aberto' AND p.prazo_fatal < ?", [hoje]],
      semana: ["p.situacao = 'aberto' AND p.prazo_fatal BETWEEN ? AND ?", [hoje, somarDias(hoje, 7)]],
      cumpridos: ["p.situacao = 'cumprido'", []],
      todos: ["1 = 1", []],
    };
    const [ondeBase, args] = filtros[visao] || filtros.abertos;
    const onde = `${ondeBase} AND COALESCE(p.categoria, 'Prazo') != 'Compromisso'`;
    const ordem = visao === "cumpridos" ? "p.data_cumprimento DESC" : "p.prazo_fatal ASC";
    const { results } = await env.DB.prepare(`SELECT p.*, pr.pasta, pr.numero FROM prazos p LEFT JOIN processos pr ON pr.id = p.processo_id
      WHERE ${onde} ORDER BY ${ordem} LIMIT 500`).bind(...args).all();
    const aba = (v, r) => html`<a href="/sistema/agenda?visao=prazos&filtro=${v}" class="${visao === v ? "ativa" : ""}">${r}</a>`;
    return resposta(pagina({
      titulo: "Prazos", sessao,
      corpo: html`
        ${cabecalhoAgenda("prazos")}
        <nav class="abas sub-abas">${aba("abertos", "Abertos")}${aba("vencidos", "Vencidos")}${aba("semana", "Próximos 7 dias")}${aba("cumpridos", "Cumpridos")}${aba("todos", "Todos")}</nav>
        ${results.length ? html`<div class="tabela-rolagem"><table>
          <thead><tr><th>Fatal</th><th>Interno</th><th>Prazo</th><th>Processo</th><th>Responsável</th><th></th></tr></thead>
          <tbody>${results.map((p) => html`<tr>
            <td class="nowrap">${dataBR(p.prazo_fatal)} ${urgencia(p.prazo_fatal, p.situacao)}</td>
            <td class="nowrap">${dataBR(p.prazo_interno)}</td>
            <td><a href="/sistema/prazos/${String(p.id)}">${p.titulo}</a>${p.tipo ? html`<br><small>${p.tipo}</small>` : ""}</td>
            <td>${p.processo_id ? html`<a href="/sistema/processos/${String(p.processo_id)}">${rotuloProcesso(p)}</a>` : "—"}</td>
            <td>${p.responsavel}</td>
            <td>${p.situacao === "aberto" ? html`<form method="post" action="/sistema/prazos/${String(p.id)}/cumprir" class="form-linha">${campoCsrf(sessao)}<button class="botao-pequeno" type="submit">Cumprido</button></form>` : html`<small>${p.situacao === "cumprido" ? `Cumprido ${dataBR(p.data_cumprimento)}` : "Cancelado"}</small>${p.comprovante_anexo_id ? html` <a class="link-pequeno" href="/sistema/anexos/${String(p.comprovante_anexo_id)}" target="_blank" rel="noopener" title="Comprovante de protocolo">📎 comprovante</a>` : ""}`}</td>
          </tr>`)}</tbody>
        </table></div>` : html`<section class="cartao"><p class="vazio">Nenhum prazo nesta seleção.</p></section>`}
        <p class="dica">${String(results.length)} prazo(s).</p>`,
    }));
}

export async function prazos(req, env, sessao, id) {
  // ---------- Lista: agora é a aba "Prazos" da Agenda ----------
  if (!id && req.method === "GET") {
    const v = new URL(req.url).searchParams.get("visao");
    return redirecionar(`/sistema/agenda?visao=prazos${v ? `&filtro=${encodeURIComponent(v)}` : ""}`);
  }

  // ---------- Mover data de trabalho (arrastar no calendário) ----------
  if (id && id.endsWith("/mover") && req.method === "POST") {
    const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return json({ ok: false, mensagem: "Sessão expirada. Recarregue a página." }, 403);
    const pid = Number(id.split("/")[0]);
    const nova = dataValida(txt(f, "data"));
    const pz = await env.DB.prepare("SELECT id, titulo, tipo, categoria, prazo_fatal, prazo_interno, situacao FROM prazos WHERE id = ?").bind(pid).first();
    if (!pz || !nova) return json({ ok: false, mensagem: "Prazo ou data inválidos." }, 400);
    if (pz.situacao !== "aberto") return json({ ok: false, mensagem: "Só itens em aberto podem ser reagendados." }, 409);
    if (dataTravada(pz)) return json({ ok: false, mensagem: "Sessão de julgamento tem data fixada e não pode ser reagendada." }, 409);
    if (pz.categoria === "Compromisso") {
      // Compromisso: reagenda livremente (a data do compromisso é a própria data fatal).
      await env.DB.prepare("UPDATE prazos SET prazo_interno = ?1, prazo_fatal = ?1, atualizado_em = ?2 WHERE id = ?3").bind(nova, agora(), pid).run();
      await auditar(env, req, sessao.usuario_id, "compromisso_reagendado", `compromisso ${pid}: ${pz.prazo_interno || pz.prazo_fatal || "-"} → ${nova}`);
      return json({ ok: true, mensagem: `"${pz.titulo}" reagendado para ${nova.split("-").reverse().join("/")}.`, noFatal: false });
    }
    if (!pz.prazo_fatal || nova > pz.prazo_fatal) {
      if (sessao.perfil === "admin") {
        // Administrador: ajusta independentemente do fatal; o fatal passa para a nova data.
        await env.DB.prepare("UPDATE prazos SET prazo_interno = ?1, prazo_fatal = ?1, atualizado_em = ?2 WHERE id = ?3").bind(nova, agora(), pid).run();
        await auditar(env, req, sessao.usuario_id, "prazo_ajustado_admin", `prazo ${pid}: interno ${pz.prazo_interno || "-"} → ${nova}; fatal ${pz.prazo_fatal || "-"} → ${nova}`);
        return json({ ok: true, mensagem: `"${pz.titulo}" reprogramado para ${nova.split("-").reverse().join("/")} (prazo fatal ajustado pelo administrador).`, noFatal: true });
      }
      return json({ ok: false, mensagem: `Não é possível passar do prazo fatal (${(pz.prazo_fatal || "").split("-").reverse().join("/")}).` }, 409);
    }
    await env.DB.prepare("UPDATE prazos SET prazo_interno = ?, atualizado_em = ? WHERE id = ?").bind(nova, agora(), pid).run();
    await auditar(env, req, sessao.usuario_id, "prazo_reprogramado", `prazo ${pid}: interno ${pz.prazo_interno || "-"} → ${nova}`);
    return json({ ok: true, mensagem: `"${pz.titulo}" reprogramado para ${nova.split("-").reverse().join("/")}.`, noFatal: nova === pz.prazo_fatal });
  }

  // ---------- Cumprir (ação rápida da lista) ----------
  if (id && /\/(reagendar|cancelar)$/.test(id) && req.method === "POST") {
    const [pid, acaoV] = id.split("/");
    return acaoVisualizacao(req, env, sessao, pid, acaoV);
  }
  if (id && id.endsWith("/cumprir") && req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    const pid = Number(id.split("/")[0]);
    const voltarItem = f.get("voltar") === "item";
    if (ok) {
      const pz = await env.DB.prepare("SELECT id, titulo, processo_id, situacao, categoria FROM prazos WHERE id = ?").bind(pid).first();
      if (pz && pz.situacao === "aberto") {
        // Comprovante de protocolo (opcional): se foi enviado e falhar, o prazo não é cumprido, para o usuário tentar de novo.
        let anexoId = null;
        try { anexoId = await salvarAnexo(env, f.get("comprovante"), "historico", sessao.usuario_id); }
        catch (e) { return redirecionar(`/sistema/prazos/${pid}?msg=anexo&m=${encodeURIComponent(e.message.slice(0, 150))}#acoes`); }
        const hoje = hojeBR(), t = agora();
        const r = await env.DB.prepare("UPDATE prazos SET situacao = 'cumprido', data_cumprimento = ?, comprovante_anexo_id = ?, atualizado_em = ? WHERE id = ? AND situacao = 'aberto'")
          .bind(hoje, anexoId, t, pid).run();
        if (r.meta.changes && anexoId && pz.processo_id) {
          // Registra no histórico da pasta: o comprovante aparece também em "Arquivos do processo".
          await env.DB.prepare("INSERT INTO historico (processo_id, data, descricao, anexo_id, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(pz.processo_id, hoje, `${pz.categoria === "Compromisso" ? "Compromisso cumprido" : "Prazo cumprido"}: ${pz.titulo} — comprovante de protocolo anexado.`, anexoId, sessao.usuario_id, t).run();
        } else if (!r.meta.changes && anexoId) await excluirAnexo(env, anexoId);
        await auditar(env, req, sessao.usuario_id, "prazo_cumprido", `prazo ${pid}${anexoId ? ` (comprovante ${anexoId})` : ""}`);
      }
    }
    if (voltarItem) return redirecionar(`/sistema/prazos/${pid}?msg=${ok ? "cumprido" : "sessao"}`);
    return redirecionar(req.headers.get("Referer")?.includes("/sistema/") ? new URL(req.headers.get("Referer")).pathname + new URL(req.headers.get("Referer")).search : "/sistema/agenda?visao=prazos");
  }

  // ---------- Novo / editar ----------
  const novo = id === "novo";
  const existente = novo ? null : await env.DB.prepare("SELECT * FROM prazos WHERE id = ?").bind(Number(id)).first();
  if (!novo && !existente) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Prazo não encontrado</h1>` }), 404);
  // Já cadastrado: só visualização (cumprir, reagendar ou cancelar). Os campos não são mais editados.
  if (!novo) return req.method === "GET" ? visualizarPrazo(req, env, sessao, existente) : redirecionar(`/sistema/prazos/${existente.id}?msg=edicao`);
  const apoio = await listasApoio(env);
  const acao = novo ? "/sistema/prazos/novo" : `/sistema/prazos/${id}`;
  const tela = (p, { erro, aviso, calculo } = {}) => resposta(pagina({
    titulo: novo ? "Novo agendamento" : p.titulo, sessao, erro, aviso,
    corpo: html`<p class="trilha">${novo ? html`<a href="/sistema/agenda">Agenda</a>` : html`<a href="/sistema/agenda?visao=${ehCompromisso(p) ? "lista" : "prazos"}">Agenda › ${ehCompromisso(p) ? "Compromissos" : "Prazos"}</a>`}</p>
      <h1>${novo ? "Novo agendamento" : p.titulo}</h1>
      ${existente?.publicacao_id ? html`<p class="subtitulo">Criado a partir de <a href="/sistema/publicacoes/${String(existente.publicacao_id)}">intimação do DJEN</a></p>` : ""}
      <section class="cartao">${formularioPrazo({ sessao, p, apoio, acao, calculo })}</section>`,
  }));

  if (req.method === "GET") {
    const sp = new URL(req.url).searchParams;
    let base = existente || { processo_id: Number(sp.get("processo")) || null, situacao: "aberto", contagem: "uteis",
      categoria: sp.get("categoria") === "Compromisso" ? "Compromisso" : "Prazo", antecedencia: sp.get("categoria") === "Compromisso" ? 0 : 2 };
    const dataSugerida = dataValida(sp.get("data") || "");
    if (!existente && dataSugerida) { base.prazo_interno = dataSugerida; base.prazo_fatal = dataSugerida; }
    // Prazos antigos gerados de intimação, ainda sem descrição: sugere o teor da intimação.
    if (existente && !existente.descricao && existente.publicacao_id) {
      const pub = await env.DB.prepare("SELECT * FROM publicacoes WHERE id = ?").bind(existente.publicacao_id).first();
      if (pub) base = { ...existente, descricao: descricaoDaIntimacao(pub) };
    }
    return tela(base, sp.get("salvo") ? { aviso: ehCompromisso(base) ? "Compromisso salvo." : "Prazo salvo." } : {});
  }
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return tela(existente || {}, { erro: "Sessão expirada. Tente novamente." });
  const { p, calculo } = await lerPrazo(env, f);
  if (existente && dataTravada(existente) && (p.prazo_fatal !== existente.prazo_fatal || p.prazo_interno !== existente.prazo_interno)) {
    p.prazo_fatal = existente.prazo_fatal; p.prazo_interno = existente.prazo_interno;
    return tela(p, { erro: "Sessão de julgamento tem data fixada e não pode ser reagendada. As datas foram mantidas." });
  }
  if (f.get("acao") === "calcular") return tela(p, calculo ? { calculo } : { erro: "Para calcular, informe a data da publicação e o número de dias." });
  if (ehCompromisso(p) && !p.prazo_fatal && p.prazo_interno) p.prazo_fatal = p.prazo_interno;
  if (!p.tipo || (!apoio.tipos[ehCompromisso(p) ? "Compromisso" : "Prazo"].includes(p.tipo) && p.tipo !== existente?.tipo)) return tela(p, { erro: `Escolha um tipo da lista de ${ehCompromisso(p) ? "compromissos" : "prazos"}.` });
  if (!p.titulo || !p.prazo_fatal) return tela(p, { erro: ehCompromisso(p) ? "Informe o tipo e a data do compromisso." : "Informe o tipo e o prazo fatal (ou a data da publicação e os dias para calcular)." });
  const novoId = await gravarPrazo(env, p, { id: novo ? null : existente.id, usuarioId: sessao.usuario_id });
  await auditar(env, req, sessao.usuario_id, novo ? "prazo_criado" : "prazo_alterado", `prazo ${novoId}`);
  return redirecionar(`/sistema/prazos/${novoId}?salvo=1`);
}
