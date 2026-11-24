// Configurações › Listas: inclusão e exclusão de opções das listas do sistema (somente administradores).
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt } from "./comum.js";
import { DEFINICOES, DEF, obterLista } from "../listas.js";

const MSG = { incluido: ["aviso", "Item incluído."], excluido: ["aviso", "Item excluído da lista. Registros que já usam esse valor não são alterados."],
  duplicado: ["erro", "Esse item já existe na lista."], vazio: ["erro", "Digite o item a incluir."], sessao: ["erro", "Sessão expirada. Tente novamente."] };

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
      const r = await env.DB.batch(novos.map((v, i) => env.DB.prepare("INSERT OR IGNORE INTO listas (lista, valor, ordem) VALUES (?, ?, ?)").bind(chave, v, max + i + 1)));
      const incluidos = r.reduce((s, x) => s + x.meta.changes, 0);
      if (!incluidos) return volta("duplicado");
      await auditar(env, req, sessao.usuario_id, "lista_item_incluido", `${chave}: ${novos.join("; ")}`.slice(0, 480));
      return volta("incluido");
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
            <button type="submit" name="acao" value="incluir">Incluir</button>
          </form>
          ${itens.length ? html`<ul class="itens-lista">${itens.map((v) => html`<li><span>${v}</span>
            <form method="post" action="/sistema/listas?lista=${chave}" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="valor" value="${v}">
              <button type="submit" name="acao" value="excluir" class="botao-pequeno botao-secundario" title="Excluir “${v}” da lista">Excluir</button></form></li>`)}</ul>`
            : html`<p class="vazio">Lista vazia.</p>`}
          ${def.ordenada ? html`<p class="dica">Esta lista segue a ordem de cadastro; os demais itens aparecem em ordem alfabética.</p>` : ""}
        </section>
      </div>`,
  }));
}
