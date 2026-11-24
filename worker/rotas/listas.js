// Configurações › Listas: inclusão e exclusão de opções das listas do sistema (somente administradores).
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt } from "./comum.js";
import { DEFINICOES, DEF, obterLista, prazosPadrao } from "../listas.js";

const MSG = { padrao: ["aviso", "Prazo padrão atualizado."], incluido: ["aviso", "Item incluído."], excluido: ["aviso", "Item excluído da lista. Registros que já usam esse valor não são alterados."],
  duplicado: ["erro", "Esse item já existe na lista."], vazio: ["erro", "Digite o item a incluir."], sessao: ["erro", "Sessão expirada. Tente novamente."] };

// Dias (1 a 365, vazio = sem padrão) e contagem do prazo padrão.
function lerPadrao(f) {
  const n = Number(f.get("dias"));
  return { dias: Number.isInteger(n) && n >= 1 && n <= 365 ? n : null, contagem: f.get("contagem") === "corridos" ? "corridos" : "uteis" };
}
const opContagem = (atual) => html`<option value="uteis"${atual !== "corridos" ? html` selected` : ""}>úteis</option><option value="corridos"${atual === "corridos" ? html` selected` : ""}>corridos</option>`;

export async function listas(req, env, sessao) {
  const url = new URL(req.url);
  const chave = DEF[url.searchParams.get("lista")] ? url.searchParams.get("lista") : DEFINICOES[0].chave;
  const def = DEF[chave];
  const volta = (codigo) => redirecionar(`/sistema/listas?lista=${chave}&msg=${codigo}`);

  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return volta("sessao");
    if (f.get("acao") === "incluir") {
      // Aceita vários itens de uma vez, um por linha.
      const novos = String(f.get("valor") || "").split(/\r?\n/).map((v) => v.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean);
      if (!novos.length) return volta("vazio");
      const max = (await env.DB.prepare("SELECT COALESCE(MAX(ordem), 0) AS m FROM listas WHERE lista = ?").bind(chave).first()).m;
      const { dias, contagem } = lerPadrao(f);
      const r = await env.DB.batch(novos.map((v, i) => env.DB.prepare("INSERT OR IGNORE INTO listas (lista, valor, ordem, dias, contagem) VALUES (?, ?, ?, ?, ?)")
        .bind(chave, v, max + i + 1, chave === "tipo_prazo" ? dias : null, chave === "tipo_prazo" && dias ? contagem : null)));
      const incluidos = r.reduce((s, x) => s + x.meta.changes, 0);
      if (!incluidos) return volta("duplicado");
      await auditar(env, req, sessao.usuario_id, "lista_item_incluido", `${chave}: ${novos.join("; ")}`.slice(0, 480));
      return volta("incluido");
    }
    if (f.get("acao") === "padrao" && chave === "tipo_prazo") {
      const valor = txt(f, "valor", 120), { dias, contagem } = lerPadrao(f);
      await env.DB.prepare("UPDATE listas SET dias = ?, contagem = ? WHERE lista = ? AND valor = ?").bind(dias, dias ? contagem : null, chave, valor).run();
      await auditar(env, req, sessao.usuario_id, "lista_prazo_padrao", `${valor}: ${dias ? `${dias} dias ${contagem}` : "sem padrão"}`);
      return volta("padrao");
    }
    if (f.get("acao") === "excluir") {
      const valor = txt(f, "valor", 120);
      await env.DB.prepare("DELETE FROM listas WHERE lista = ? AND valor = ?").bind(chave, valor).run();
      await auditar(env, req, sessao.usuario_id, "lista_item_excluido", `${chave}: ${valor}`);
      return volta("excluido");
    }
    return volta("sessao");
  }

  const itens = await obterLista(env, chave);
  const padroes = chave === "tipo_prazo" ? await prazosPadrao(env) : {};
  const contagens = Object.fromEntries((await env.DB.prepare("SELECT lista, COUNT(*) AS n FROM listas GROUP BY lista").all()).results.map((r) => [r.lista, r.n]));
  const m = MSG[url.searchParams.get("msg")];
  const grupos = [...new Set(DEFINICOES.map((d) => d.grupo))];
  return resposta(pagina({
    titulo: "Listas", sessao, ...(m ? { [m[0]]: m[1] } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/configuracoes">Configurações</a></p>
      <h1>Listas</h1>
      <p class="dica">Opções que aparecem nos campos de seleção do sistema. Excluir um item não altera registros que já o utilizam; ele só deixa de ser oferecido em novos cadastros.</p>
      <div class="listas-layout">
        <nav class="listas-menu" aria-label="Listas">${grupos.map((g) => html`<p class="listas-grupo">${g}</p>
          ${DEFINICOES.filter((d) => d.grupo === g).map((d) => html`<a href="/sistema/listas?lista=${d.chave}" class="${d.chave === chave ? "ativa" : ""}">${d.nome}<span>${String(contagens[d.chave] || 0)}</span></a>`)}`)}
        </nav>
        <section class="cartao listas-conteudo">
          <h2>${def.nome} <span class="contagem">${String(itens.length)}</span></h2>
          <form method="post" action="/sistema/listas?lista=${chave}" class="formulario form-incluir-item">${campoCsrf(sessao)}
            <label>Incluir item <small>(para incluir vários, um por linha)</small><textarea name="valor" rows="2" maxlength="3000" required></textarea></label>
            ${chave === "tipo_prazo" ? html`<label class="campo-dias">Prazo padrão<span class="dias-contagem"><input type="number" name="dias" min="1" max="365" placeholder="dias"><select name="contagem">${opContagem("uteis")}</select></span></label>` : ""}
            <button type="submit" name="acao" value="incluir">Incluir</button>
          </form>
          ${chave === "tipo_prazo" && itens.length ? html`<div class="tabela-rolagem"><table class="tabela-prazos-padrao">
            <thead><tr><th>Tipo de prazo</th><th>Prazo padrão</th><th></th></tr></thead>
            <tbody>${itens.map((v) => html`<tr><td>${v}</td>
              <td><form method="post" action="/sistema/listas?lista=${chave}" class="form-padrao">${campoCsrf(sessao)}<input type="hidden" name="valor" value="${v}">
                <span class="dias-contagem"><input type="number" name="dias" min="1" max="365" value="${padroes[v]?.dias ?? ""}" placeholder="—" aria-label="Dias para ${v}">
                <select name="contagem" aria-label="Contagem para ${v}">${opContagem(padroes[v]?.contagem)}</select></span>
                <button type="submit" name="acao" value="padrao" class="botao-pequeno">Salvar</button></form></td>
              <td><form method="post" action="/sistema/listas?lista=${chave}" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="valor" value="${v}">
                <button type="submit" name="acao" value="excluir" class="botao-pequeno botao-secundario">Excluir</button></form></td></tr>`)}</tbody></table></div>
            <p class="dica">O prazo padrão preenche automaticamente "Prazo (dias)" no agendamento e na triagem de intimações; pode ser alterado em cada prazo. Deixe em branco quando o prazo é fixado pelo juiz.</p>`
          : itens.length ? html`<ul class="itens-lista">${itens.map((v) => html`<li><span>${v}</span>
            <form method="post" action="/sistema/listas?lista=${chave}" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="valor" value="${v}">
              <button type="submit" name="acao" value="excluir" class="botao-pequeno botao-secundario" title="Excluir “${v}” da lista">Excluir</button></form></li>`)}</ul>`
            : html`<p class="vazio">Lista vazia.</p>`}
          ${def.ordenada ? html`<p class="dica">Esta lista segue a ordem de cadastro; os demais itens aparecem em ordem alfabética.</p>` : ""}
        </section>
      </div>`,
  }));
}
