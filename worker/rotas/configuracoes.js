// Configurações (administradores): OABs monitoradas, captura do DJEN e feriados.
import { html, pagina, resposta, campoCsrf } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { feriadosNacionais, hojeBR } from "../calendario.js";
import { capturarDjen } from "../djen.js";
import { csrfOk, txt, dataValida, dataBR } from "./comum.js";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const quando = (t) => new Date(t * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function oabs(req, env, sessao) {
  let aviso = null, erro = null;
  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) erro = "Sessão expirada. Tente novamente.";
    else if (f.get("acao") === "adicionar") {
      const numero = String(f.get("numero") || "").replace(/\D/g, "");
      const uf = String(f.get("uf") || "");
      if (!numero || !UFS.includes(uf)) erro = "Informe o número e a UF da OAB.";
      else {
        await env.DB.prepare("INSERT INTO oabs (numero, uf, advogado, criado_em) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(numero, uf, txt(f, "advogado", 120), agora()).run();
        await auditar(env, req, sessao.usuario_id, "oab_adicionada", `${numero}/${uf}`);
        aviso = `OAB ${numero}/${uf} adicionada.`;
      }
    } else if (f.get("acao") === "alternar") {
      await env.DB.prepare("UPDATE oabs SET ativo = 1 - ativo WHERE id = ?").bind(Number(f.get("id"))).run();
      aviso = "Monitoramento atualizado.";
    } else if (f.get("acao") === "buscar") {
      const r = await capturarDjen(env, "manual");
      await auditar(env, req, sessao.usuario_id, "djen_captura_manual", JSON.stringify(r).slice(0, 400));
      const falhas = r.filter((x) => x.erro);
      aviso = r.filter((x) => !x.erro).map((x) => `${x.oab}: ${x.encontradas} encontrada(s), ${x.novas} nova(s)`).join(" · ") || null;
      erro = falhas.length ? falhas.map((x) => `${x.oab}: ${x.erro}`).join(" · ") : null;
    }
  }
  const [{ results: lista }, { results: capturas }] = await Promise.all([
    env.DB.prepare("SELECT * FROM oabs ORDER BY uf, numero").all(),
    env.DB.prepare("SELECT * FROM capturas ORDER BY id DESC LIMIT 15").all(),
  ]);
  return resposta(pagina({
    titulo: "OABs e DJEN", sessao, aviso, erro,
    corpo: html`
      <h1>OABs monitoradas no DJEN</h1>
      <p class="dica">A captura roda automaticamente às 7h e às 13h (horário de Brasília), revisando os últimos 10 dias. Intimações novas vão para a fila de triagem.</p>
      <div class="tabela-rolagem"><table>
        <thead><tr><th>OAB</th><th>Advogado</th><th>Monitoramento</th><th></th></tr></thead>
        <tbody>${lista.map((o) => html`<tr class="${o.ativo ? "" : "inativo"}"><td>${o.numero}/${o.uf}</td><td>${o.advogado}</td><td>${o.ativo ? "Ativo" : "Pausado"}</td>
          <td><form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="id" value="${String(o.id)}"><button class="botao-pequeno" name="acao" value="alternar">${o.ativo ? "Pausar" : "Reativar"}</button></form></td></tr>`)}</tbody>
      </table></div>
      <section class="cartao"><h2>Adicionar OAB</h2>
        <form method="post" class="formulario em-linha">${campoCsrf(sessao)}
          <label>Número<input name="numero" required inputmode="numeric" maxlength="10"></label>
          <label>UF<select name="uf">${UFS.map((u) => html`<option${u === "RS" ? html` selected` : ""}>${u}</option>`)}</select></label>
          <label>Advogado<input name="advogado" maxlength="120"></label>
          <button type="submit" name="acao" value="adicionar">Adicionar</button>
        </form>
      </section>
      <section class="cartao"><div class="titulo-acoes"><h2>Capturas recentes</h2>
        <form method="post">${campoCsrf(sessao)}<button type="submit" name="acao" value="buscar">Buscar agora</button></form></div>
        ${capturas.length ? html`<ul class="lista-simples">${capturas.map((c) => html`<li><span>${quando(c.criado_em)} · ${({ acesso: "automática (ao abrir o sistema)" })[c.origem] || c.origem} · ${c.oab}</span>
          <span>${c.erro ? html`<span class="alerta-texto">${c.erro}</span>` : `${c.encontradas} encontrada(s), ${c.novas} nova(s)`}</span></li>`)}</ul>` : html`<p>Nenhuma captura ainda.</p>`}
      </section>`,
  }));
}

export async function feriados(req, env, sessao) {
  let aviso = null, erro = null;
  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) erro = "Sessão expirada. Tente novamente.";
    else if (f.get("acao") === "adicionar") {
      const data = dataValida(txt(f, "data")), descricao = txt(f, "descricao", 150);
      if (!data || !descricao) erro = "Informe a data e a descrição.";
      else {
        await env.DB.prepare("INSERT INTO feriados (data, descricao, abrangencia, criado_em) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(data, descricao, txt(f, "abrangencia", 80), agora()).run();
        await auditar(env, req, sessao.usuario_id, "feriado_adicionado", `${data} ${descricao}`);
        aviso = "Feriado cadastrado. Prazos já salvos não são recalculados automaticamente.";
      }
    } else if (f.get("acao") === "remover") {
      await env.DB.prepare("DELETE FROM feriados WHERE id = ?").bind(Number(f.get("id"))).run();
      await auditar(env, req, sessao.usuario_id, "feriado_removido", String(f.get("id")));
      aviso = "Feriado removido.";
    }
  }
  const ano = Number(hojeBR().slice(0, 4));
  const { results: locais } = await env.DB.prepare("SELECT * FROM feriados WHERE data >= ? ORDER BY data").bind(`${ano}-01-01`).all();
  // Anos exibidos: o atual, o próximo e qualquer outro com feriado cadastrado.
  const anos = [...new Set([ano, ano + 1, ...locais.map((x) => Number(x.data.slice(0, 4)))])].sort();
  const remover = (x) => html`<form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="id" value="${String(x.id)}"><button class="botao-pequeno botao-secundario" name="acao" value="remover">Remover</button></form>`;
  return resposta(pagina({
    titulo: "Feriados", sessao, aviso, erro,
    corpo: html`
      <h1>Feriados e dias sem expediente</h1>
      <p class="dica">Os feriados nacionais, o Carnaval, a Sexta-feira Santa, o Corpus Christi e o recesso forense de 20/12 a 20/01 (CPC, art. 220: prazos suspensos, sem contagem e sem vencimento no período) já entram no cálculo automaticamente. Cadastre aqui os feriados estaduais, municipais e as suspensões de expediente dos tribunais.</p>
      <section class="cartao"><h2>Cadastrar feriado</h2>
        <form method="post" class="formulario em-linha">${campoCsrf(sessao)}
          <label>Data<input type="date" name="data" required></label>
          <label>Descrição<input name="descricao" required maxlength="150" placeholder="Ex.: Revolução Farroupilha"></label>
          <label>Abrangência<input name="abrangencia" maxlength="80" placeholder="Ex.: RS, TJRS, Caxias do Sul"></label>
          <button type="submit" name="acao" value="adicionar">Cadastrar</button>
        </form>
      </section>
      <section class="cartao"><h2>Feriados</h2>
        <div class="duas-colunas">${anos.map((a) => {
          const doAno = locais.filter((x) => x.data.startsWith(`${a}-`));
          return html`<div class="feriados-ano"><h3>${String(a)}</h3>
            <p class="feriados-subtitulo">Nacionais (automáticos)</p>
            <ul class="lista-simples">${feriadosNacionais(a).map(([d, n]) => html`<li><span>${dataBR(d)}</span><span>${n}</span></li>`)}
              <li class="linha-recesso"><span>20/12/${String(a)} a 20/01/${String(a + 1)}</span><span>Recesso forense: prazos suspensos (CPC, art. 220)</span></li></ul>
            <p class="feriados-subtitulo">Cadastrados</p>
            ${doAno.length ? html`<ul class="lista-simples feriados-cadastrados">${doAno.map((x) => html`<li>
              <span>${dataBR(x.data)}</span><span class="feriado-desc">${x.descricao}${x.abrangencia ? html` <small>(${x.abrangencia})</small>` : ""}</span>${remover(x)}</li>`)}</ul>`
              : html`<p class="vazio">Nenhum feriado cadastrado para ${String(a)}.</p>`}
          </div>`;
        })}</div>
      </section>`,
  }));
}
