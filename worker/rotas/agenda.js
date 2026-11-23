// Agenda de compromissos (audiências, reuniões, diligências).
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { hojeBR } from "../calendario.js";
import { opcoes, listasApoio, csrfOk, txt, dataValida, dataBR } from "./comum.js";

const SITUACOES = [["agendado", "Agendado"], ["realizado", "Realizado"], ["cancelado", "Cancelado"]];

export async function agenda(req, env, sessao, id) {
  if (!id) {
    const passados = new URL(req.url).searchParams.get("visao") === "anteriores";
    const { results } = await env.DB.prepare(`SELECT a.*, pr.pasta, pr.numero FROM agenda a LEFT JOIN processos pr ON pr.id = a.processo_id
      WHERE a.data ${passados ? "<" : ">="} ? ORDER BY a.data ${passados ? "DESC" : "ASC"}, a.hora LIMIT 300`).bind(hojeBR()).all();
    return resposta(pagina({
      titulo: "Agenda", sessao,
      corpo: html`
        <div class="titulo-acoes"><h1>Agenda</h1><a class="botao-link" href="/sistema/agenda/novo">Novo compromisso</a></div>
        <nav class="abas"><a href="/sistema/agenda" class="${passados ? "" : "ativa"}">Próximos</a><a href="/sistema/agenda?visao=anteriores" class="${passados ? "ativa" : ""}">Anteriores</a></nav>
        ${results.length ? html`<div class="tabela-rolagem"><table>
          <thead><tr><th>Data</th><th>Compromisso</th><th>Local</th><th>Processo</th><th>Situação</th></tr></thead>
          <tbody>${results.map((a) => html`<tr>
            <td class="nowrap">${dataBR(a.data)} ${a.hora || ""}</td>
            <td><a href="/sistema/agenda/${String(a.id)}">${a.titulo}</a>${a.tipo ? html`<br><small>${a.tipo}</small>` : ""}</td>
            <td>${a.local}</td>
            <td>${a.processo_id ? html`<a href="/sistema/processos/${String(a.processo_id)}">${a.pasta ? `Pasta ${a.pasta}` : a.numero}</a>` : "—"}</td>
            <td>${SITUACOES.find((s) => s[0] === a.situacao)?.[1]}</td></tr>`)}</tbody>
        </table></div>` : html`<section class="cartao"><p>Nenhum compromisso ${passados ? "anterior" : "agendado"}.</p></section>`}`,
    }));
  }

  const novo = id === "novo";
  const ex = novo ? null : await env.DB.prepare("SELECT * FROM agenda WHERE id = ?").bind(Number(id)).first();
  if (!novo && !ex) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Compromisso não encontrado</h1>` }), 404);
  const apoio = await listasApoio(env);
  const tela = (a, erro) => resposta(pagina({
    titulo: novo ? "Novo compromisso" : a.titulo, sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/agenda">Agenda</a></p><h1>${novo ? "Novo compromisso" : a.titulo}</h1>
      <section class="cartao"><form method="post" class="formulario grade-form">${campoCsrf(sessao)}
        <label class="largo">Título<input name="titulo" required maxlength="200" value="${a.titulo || ""}"></label>
        <label>Tipo<input name="tipo" maxlength="100" value="${a.tipo || ""}" list="tipos-agenda"></label>
        <label>Situação<select name="situacao">${opcoes(SITUACOES, a.situacao || "agendado", "Agendado")}</select></label>
        <label>Data<input type="date" name="data" required value="${a.data || ""}"></label>
        <label>Hora<input type="time" name="hora" value="${a.hora || ""}"></label>
        <label class="largo">Local<input name="local" maxlength="300" value="${a.local || ""}" placeholder="Endereço, sala virtual ou fórum"></label>
        <label class="largo">Processo<select name="processo_id">${opcoes(apoio.processos, a.processo_id, "Sem processo vinculado")}</select></label>
        <label class="largo">Observações<textarea name="observacoes" rows="3" maxlength="4000">${a.observacoes || ""}</textarea></label>
        <div class="largo botoes-form"><button type="submit">Salvar</button></div>
        <datalist id="tipos-agenda"><option value="Audiência"><option value="Reunião com cliente"><option value="Perícia"><option value="Diligência"><option value="Sessão de julgamento"></datalist>
      </form></section>`,
  }));
  if (req.method === "GET") return tela(ex || { processo_id: Number(new URL(req.url).searchParams.get("processo")) || null });
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return tela(ex || {}, "Sessão expirada. Tente novamente.");
  const a = {
    titulo: txt(f, "titulo", 200), tipo: txt(f, "tipo", 100), data: dataValida(txt(f, "data")), hora: txt(f, "hora", 10),
    local: txt(f, "local", 300), processo_id: Number(f.get("processo_id")) || null, observacoes: txt(f, "observacoes", 4000),
    situacao: ["agendado", "realizado", "cancelado"].includes(f.get("situacao")) ? f.get("situacao") : "agendado",
  };
  if (!a.titulo || !a.data) return tela(a, "Informe o título e a data.");
  const t = agora();
  let aid = ex?.id;
  if (ex) {
    await env.DB.prepare("UPDATE agenda SET titulo=?, tipo=?, data=?, hora=?, local=?, processo_id=?, observacoes=?, situacao=?, atualizado_em=? WHERE id=?")
      .bind(a.titulo, a.tipo, a.data, a.hora, a.local, a.processo_id, a.observacoes, a.situacao, t, ex.id).run();
  } else {
    const r = await env.DB.prepare("INSERT INTO agenda (titulo, tipo, data, hora, local, processo_id, observacoes, situacao, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(a.titulo, a.tipo, a.data, a.hora, a.local, a.processo_id, a.observacoes, a.situacao, sessao.usuario_id, t, t).run();
    aid = r.meta.last_row_id;
  }
  await auditar(env, req, sessao.usuario_id, ex ? "compromisso_alterado" : "compromisso_criado", `agenda ${aid}`);
  return redirecionar("/sistema/agenda");
}
