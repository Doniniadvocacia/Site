// Configurações › Verificação de cadastros (somente administradores): possíveis pessoas duplicadas, clientes sem processo
// e processos sem cliente. Permite unificar dois cadastros (tudo o que estava ligado ao duplicado passa para o principal).
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora, decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { csrfOk } from "./comum.js";
import { lerColecao } from "./importar.js";
import { msConfigurado, moverPastaDoProcesso } from "../microsoft.js";

const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digitos = (s) => String(s || "").replace(/\D/g, "");
// Palavras que não identificam ninguém (tipos de sociedade, ramos genéricos, partículas de nome).
const COMUNS = new Set(["ltda", "eireli", "epp", "limitada", "comercio", "servicos", "industria", "empresa", "grupo", "brasil", "sociedade",
  "associacao", "participacoes", "holding", "filho", "filha", "junior", "neto", "neta", "sobrinho", "advogados", "advocacia", "seguros",
  "seguradora", "transportes", "construtora", "comercial", "distribuidora", "representacoes", "consultoria", "administradora"]);
const palavras = (nome) => [...new Set(normalizar(nome).split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !COMUNS.has(p)))];

// Tabelas e colunas que apontam para uma pessoa.
const REFERENCIAS = [["processos", "cliente_id"], ["processos", "parte_contraria_id"], ["processo_partes", "pessoa_id"], ["financeiro", "cliente_id"],
  ["historico", "cliente_id"], ["agenda", "cliente_id"], ["leads", "cliente_id"], ["crm_interacoes", "cliente_id"], ["crm_tarefas", "cliente_id"], ["usuarios", "cliente_id"]];
// Campos do cadastro: no principal, os vazios são preenchidos com os do duplicado.
const CAMPOS = ["tipo", "posicao", "genero", "estado_civil", "profissao", "cidade", "estado", "documento_enc", "data_nascimento_enc", "email_enc",
  "telefone_enc", "endereco_enc", "endereco_dados_enc", "observacoes_enc", "origem", "asaas_id", "sharepoint_item"];

async function carregar(env) {
  const { results } = await env.DB.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM processos p WHERE p.cliente_id = c.id) AS n_proc,
      (SELECT COUNT(*) FROM processos p WHERE p.parte_contraria_id = c.id) + (SELECT COUNT(*) FROM processo_partes pp WHERE pp.pessoa_id = c.id) AS n_parte,
      (SELECT COUNT(*) FROM financeiro f WHERE f.cliente_id = c.id) AS n_fin,
      (SELECT COUNT(*) FROM historico h WHERE h.cliente_id = c.id) AS n_hist
    FROM clientes c ORDER BY c.nome COLLATE NOCASE`).all();
  await Promise.all(results.map(async (c) => {
    const [doc, email, tel] = await Promise.all([c.documento_enc, c.email_enc, c.telefone_enc].map((v) => decifrar(env, v).catch(() => "")));
    Object.assign(c, { doc: digitos(doc), docTexto: doc, email: normalizar(email), tel: digitos(tel) });
  }));
  return results;
}

// Pares suspeitos, com os motivos. Palavra do nome só conta se for rara (no máximo 2 cadastros a usam).
function pares(pessoas, distintos) {
  const freq = new Map();
  for (const p of pessoas) for (const w of palavras(p.nome)) freq.set(w, (freq.get(w) || 0) + 1);
  const mapa = new Map();
  const add = (a, b, motivo) => {
    if (a.id === b.id) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    if (distintos.has(`${x.id}:${y.id}`)) return;
    const k = `${x.id}:${y.id}`;
    if (!mapa.has(k)) mapa.set(k, { a: x, b: y, motivos: new Set() });
    mapa.get(k).motivos.add(motivo);
  };
  const agrupar = (chave, motivo) => {
    const g = new Map();
    for (const p of pessoas) { const v = chave(p); if (v) (g.get(v) || g.set(v, []).get(v)).push(p); }
    for (const lista of g.values()) for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) add(lista[i], lista[j], motivo);
  };
  agrupar((p) => (p.doc.length >= 11 ? p.doc : null), "mesmo CPF/CNPJ");
  agrupar((p) => normalizar(p.nome).replace(/\s+/g, " ") || null, "mesmo nome");
  agrupar((p) => (p.email.includes("@") ? p.email : null), "mesmo e-mail");
  agrupar((p) => (p.tel.length >= 10 ? p.tel : null), "mesmo telefone");
  const porPalavra = new Map();
  for (const p of pessoas) for (const w of palavras(p.nome)) if (freq.get(w) === 2) (porPalavra.get(w) || porPalavra.set(w, []).get(w)).push(p);
  for (const [w, lista] of porPalavra) if (lista.length === 2) add(lista[0], lista[1], `nome parecido ("${w}")`);
  // Mais fortes primeiro: documento/nome idênticos antes de "nome parecido".
  const peso = (m) => (m.has("mesmo CPF/CNPJ") ? 4 : 0) + (m.has("mesmo nome") ? 3 : 0) + (m.has("mesmo e-mail") || m.has("mesmo telefone") ? 2 : 0) + 1;
  return [...mapa.values()].sort((x, y) => peso(y.motivos) - peso(x.motivos) || x.a.nome.localeCompare(y.a.nome, "pt-BR"));
}

// Une o cadastro `dup` ao `principal`: move tudo o que aponta para o duplicado, completa os campos vazios e apaga o duplicado.
export async function unificar(env, principalId, dupId) {
  const [p, d] = await Promise.all([principalId, dupId].map((id) => env.DB.prepare("SELECT * FROM clientes WHERE id = ?").bind(id).first()));
  if (!p || !d || p.id === d.id) throw new Error("Cadastros inválidos.");
  const sets = [], vals = [];
  for (const k of CAMPOS) if ((p[k] === null || p[k] === "") && d[k]) { sets.push(`${k} = ?`); vals.push(d[k]); }
  const etiquetas = [...new Set([p.etiquetas, d.etiquetas].flatMap((e) => String(e || "").split(",").map((x) => x.trim()).filter(Boolean)))].join(", ");
  if (etiquetas !== (p.etiquetas || "")) { sets.push("etiquetas = ?"); vals.push(etiquetas || null); }
  if (d.data_cadastro && (!p.data_cadastro || d.data_cadastro < p.data_cadastro)) { sets.push("data_cadastro = ?"); vals.push(d.data_cadastro); }
  if (d.cliente && !p.cliente) { sets.push("cliente = 1", "vinculo = 'Cliente'"); }
  if (d.monitorar && !p.monitorar) sets.push("monitorar = 1");
  sets.push("editado_local = 1", "atualizado_em = ?"); vals.push(agora());
  const ops = [env.DB.prepare(`UPDATE clientes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, p.id)];
  // Processos movidos ficam marcados como editados aqui: a importação do Wix não desfaz o vínculo novo.
  ops.push(env.DB.prepare("UPDATE processos SET editado_local = 1 WHERE cliente_id = ?").bind(d.id));
  for (const [tab, col] of REFERENCIAS) ops.push(env.DB.prepare(`UPDATE ${tab} SET ${col} = ? WHERE ${col} = ?`).bind(p.id, d.id));
  // O nome da parte principal acompanha o cadastro que ficou.
  ops.push(env.DB.prepare("UPDATE processos SET parte_contraria = ? WHERE parte_contraria_id = ?").bind(p.nome, p.id));
  ops.push(env.DB.prepare("UPDATE processo_partes SET nome = ? WHERE pessoa_id = ?").bind(p.nome, p.id));
  if (d.wix_id) ops.push(env.DB.prepare("INSERT OR REPLACE INTO cadastros_unificados (wix_id, cliente_id, unificado_em) VALUES (?, ?, ?)").bind(d.wix_id, p.id, agora()));
  ops.push(env.DB.prepare("UPDATE cadastros_unificados SET cliente_id = ? WHERE cliente_id = ?").bind(p.id, d.id));
  ops.push(env.DB.prepare("DELETE FROM cadastros_distintos WHERE a = ? OR b = ?").bind(d.id, d.id));
  ops.push(env.DB.prepare("DELETE FROM clientes WHERE id = ?").bind(d.id));
  await env.DB.batch(ops);
  return { principal: p, duplicado: d };
}

// Liga o texto "parte contrária" dos processos (os importados e os antigos) ao cadastro de pessoas: usa o cadastro com o
// mesmo nome; se não houver, cria um com vínculo "Parte Adversa". Assim o processo aparece também na ficha da parte.
export async function partesSemCadastro(env) {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM processos WHERE parte_contraria_id IS NULL AND TRIM(COALESCE(parte_contraria, '')) != ''").first())?.n || 0;
}
export async function vincularPartes(env, limite = 500) {
  const { results } = await env.DB.prepare("SELECT id, parte_contraria FROM processos WHERE parte_contraria_id IS NULL AND TRIM(COALESCE(parte_contraria, '')) != '' LIMIT ?").bind(limite).all();
  if (!results.length) return { ligados: 0, criados: 0 };
  const { results: pessoas } = await env.DB.prepare("SELECT id, nome FROM clientes ORDER BY id").all();
  const chave = (s) => normalizar(s).replace(/\s+/g, " ");
  const porNome = new Map();
  for (const c of pessoas) if (!porNome.has(chave(c.nome))) porNome.set(chave(c.nome), c.id);
  let criados = 0;
  const ops = [];
  for (const p of results) {
    const nome = String(p.parte_contraria).trim().replace(/\s+/g, " ").slice(0, 200);
    let id = porNome.get(chave(nome));
    if (!id) {
      const t = agora();
      id = (await env.DB.prepare("INSERT INTO clientes (nome, vinculo, cliente, criado_em, atualizado_em, editado_local) VALUES (?, 'Parte Adversa', 0, ?, ?, 1)").bind(nome, t, t).run()).meta.last_row_id;
      porNome.set(chave(nome), id); criados++;
    }
    ops.push(env.DB.prepare("UPDATE processos SET parte_contraria_id = ? WHERE id = ? AND parte_contraria_id IS NULL").bind(id, p.id));
  }
  for (let i = 0; i < ops.length; i += 50) await env.DB.batch(ops.slice(i, i + 50));
  return { ligados: ops.length, criados };
}

// Compara o cliente de cada processo com o nome do cliente registrado nos andamentos e lançamentos do Wix
// (que guardam o nome em texto). Divergência: o nome mais citado não é o do cliente vinculado.
async function divergenciasWix(env, pessoas) {
  const [hist, fin] = await Promise.all([lerColecao(env, "Historico"), lerColecao(env, "Financeiro")]);
  const { results: procs } = await env.DB.prepare(`SELECT p.id, p.pasta, p.numero, p.cliente_id, p.parte_contraria, c.nome AS cliente,
      (SELECT GROUP_CONCAT(pp.nome, '|') FROM processo_partes pp WHERE pp.processo_id = p.id) AS outras
    FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id`).all();
  const porNumero = new Map(procs.filter((x) => x.numero).map((x) => [digitos(x.numero), x]));
  const porPasta = new Map(procs.filter((x) => x.pasta).map((x) => [String(x.pasta).trim(), x]));
  const porNome = new Map(pessoas.map((c) => [normalizar(c.nome).replace(/\s+/g, " "), c]));
  const citacoes = new Map();
  for (const it of [...hist, ...fin]) {
    const nome = String(typeof it.cliente === "string" ? it.cliente : "").trim();
    if (!nome) continue;
    const proc = (it.numeroProcesso && porNumero.get(digitos(it.numeroProcesso))) || (it.pasta && porPasta.get(String(it.pasta).trim()));
    if (!proc) continue;
    const m = citacoes.get(proc.id) || citacoes.set(proc.id, { proc, nomes: new Map() }).get(proc.id);
    const k = normalizar(nome).replace(/\s+/g, " ");
    m.nomes.set(k, { nome, n: (m.nomes.get(k)?.n || 0) + 1 });
  }
  const lista = [];
  for (const { proc, nomes } of citacoes.values()) {
    const [k, top] = [...nomes.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    const conhecidos = [proc.cliente, proc.parte_contraria, ...String(proc.outras || "").split("|")].map((x) => normalizar(x).replace(/\s+/g, " "));
    if (conhecidos.includes(k)) continue; // é o cliente ou uma parte contrária já registrada
    if (!proc.cliente_id) { lista.push({ proc, citado: top.nome, vezes: top.n, sugerido: porNome.get(k) || null }); continue; }
    lista.push({ proc, citado: top.nome, vezes: top.n, sugerido: porNome.get(k) || null });
  }
  return lista.sort((a, b) => String(a.proc.pasta || "").localeCompare(String(b.proc.pasta || ""), "pt-BR", { numeric: true }));
}

async function corrigirVinculo(env, processoId, pessoaId) {
  const c = await env.DB.prepare("SELECT id, nome FROM clientes WHERE id = ?").bind(pessoaId).first();
  const p = await env.DB.prepare("SELECT id, pasta, cliente_id FROM processos WHERE id = ?").bind(processoId).first();
  if (!c || !p) throw new Error("Processo ou pessoa não encontrados.");
  await env.DB.batch([
    env.DB.prepare("UPDATE processos SET cliente_id = ?, editado_local = 1, atualizado_em = ? WHERE id = ?").bind(c.id, agora(), p.id),
    env.DB.prepare("UPDATE historico SET cliente_id = ? WHERE processo_id = ?").bind(c.id, p.id),
    env.DB.prepare("UPDATE financeiro SET cliente_id = ? WHERE processo_id = ? AND (cliente_id IS NULL OR cliente_id = ?)").bind(c.id, p.id, p.cliente_id || 0),
    env.DB.prepare("UPDATE clientes SET cliente = 1, vinculo = 'Cliente' WHERE id = ? AND cliente = 0").bind(c.id),
  ]);
  const sp = msConfigurado(env) ? await moverPastaDoProcesso(env, p.id).catch((e) => ({ erro: e.message })) : null;
  return { p, c, sp };
}

const mascararDoc = (s) => (s ? String(s).replace(/\d(?=(?:\D*\d){4})/g, "•") : "");

export async function verificacao(req, env, sessao) {
  const volta = (msg, extra = "") => redirecionar(`/sistema/verificacao?msg=${msg}${extra}`);
  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return volta("sessao");
    const a = Number(f.get("principal") || f.get("a")), b = Number(f.get("duplicado") || f.get("b"));
    if (f.get("acao") === "unificar") {
      try {
        const r = await unificar(env, a, b);
        await auditar(env, req, sessao.usuario_id, "cadastros_unificados", `pessoa ${r.duplicado.id} (${r.duplicado.nome}) unificada em ${r.principal.id} (${r.principal.nome})`);
        return volta("unificado", `&p=${r.principal.id}`);
      } catch (e) { return volta("erro", `&m=${encodeURIComponent(e.message.slice(0, 150))}`); }
    }
    if (f.get("acao") === "corrigir" || f.get("acao") === "corrigir_todos") {
      const pares = f.get("acao") === "corrigir" ? [[Number(f.get("processo")), Number(f.get("pessoa"))]]
        : f.getAll("par").map((v) => v.split(":").map(Number));
      let feitos = 0, erroSp = "";
      for (const [pid, cid] of pares.filter(([x, y]) => x && y)) {
        try {
          const r = await corrigirVinculo(env, pid, cid); feitos++;
          if (r.sp?.erro) erroSp = r.sp.erro;
          await auditar(env, req, sessao.usuario_id, "vinculo_corrigido", `processo ${r.p.id} (pasta ${r.p.pasta || "-"}): cliente ${r.p.cliente_id || "-"} → ${r.c.id} (${r.c.nome})`);
        } catch (e) { return volta("erro", `&m=${encodeURIComponent(e.message.slice(0, 150))}`); }
      }
      return volta("corrigido", `&n=${feitos}${erroSp ? `&m=${encodeURIComponent(`SharePoint: ${erroSp.slice(0, 120)}`)}` : ""}&wix=1`);
    }
    if (f.get("acao") === "parte") {
      const pid = Number(f.get("processo")), nome = String(f.get("nome") || "").trim().slice(0, 200);
      const p = await env.DB.prepare("SELECT id, pasta, parte_contraria, parte_contraria_id FROM processos WHERE id = ?").bind(pid).first();
      if (!p || !nome) return volta("erro");
      let pessoa = await env.DB.prepare("SELECT id, nome FROM clientes WHERE TRIM(nome) = ? COLLATE NOCASE ORDER BY id LIMIT 1").bind(nome).first();
      if (!pessoa) { const t = agora(); pessoa = { id: (await env.DB.prepare("INSERT INTO clientes (nome, vinculo, cliente, criado_em, atualizado_em, editado_local) VALUES (?, 'Parte Adversa', 0, ?, ?, 1)").bind(nome, t, t).run()).meta.last_row_id, nome }; }
      if (!p.parte_contraria && !p.parte_contraria_id) await env.DB.prepare("UPDATE processos SET parte_contraria = ?, parte_contraria_id = ?, editado_local = 1 WHERE id = ?").bind(pessoa.nome, pessoa.id, p.id).run();
      else if (p.parte_contraria_id !== pessoa.id && !(await env.DB.prepare("SELECT 1 FROM processo_partes WHERE processo_id = ? AND pessoa_id = ?").bind(p.id, pessoa.id).first())) {
        const ordem = (await env.DB.prepare("SELECT COALESCE(MAX(ordem), -1) + 1 AS o FROM processo_partes WHERE processo_id = ?").bind(p.id).first()).o;
        await env.DB.prepare("INSERT INTO processo_partes (processo_id, pessoa_id, nome, ordem) VALUES (?, ?, ?, ?)").bind(p.id, pessoa.id, pessoa.nome, ordem).run();
      }
      await auditar(env, req, sessao.usuario_id, "parte_vinculada", `processo ${p.id} (pasta ${p.pasta || "-"}): parte contrária ${pessoa.id} (${pessoa.nome})`);
      return volta("parte", "&wix=1");
    }
    if (f.get("acao") === "vincular_partes") {
      const r = await vincularPartes(env);
      await auditar(env, req, sessao.usuario_id, "partes_vinculadas", `${r.ligados} processo(s); ${r.criados} cadastro(s) de parte adversa criado(s)`);
      return volta("partes", `&l=${r.ligados}&c=${r.criados}`);
    }
    if (f.get("acao") === "distintos" && a && b) {
      await env.DB.prepare("INSERT OR IGNORE INTO cadastros_distintos (a, b) VALUES (?, ?)").bind(Math.min(a, b), Math.max(a, b)).run();
      return volta("distintos");
    }
    return volta("erro");
  }

  const url = new URL(req.url);
  const pessoas = await carregar(env);
  const { results: dist } = await env.DB.prepare("SELECT a, b FROM cadastros_distintos").all();
  const lista = pares(pessoas, new Set(dist.map((x) => `${x.a}:${x.b}`)));
  const semProcesso = pessoas.filter((p) => p.cliente && !p.n_proc);
  const { results: semCliente } = await env.DB.prepare("SELECT id, pasta, numero, parte_contraria FROM processos WHERE cliente_id IS NULL OR cliente_id NOT IN (SELECT id FROM clientes) ORDER BY CAST(pasta AS INTEGER), pasta").all();
  const msg = url.searchParams.get("msg");
  let divergencias = null, erroWix = null;
  if (url.searchParams.get("wix") === "1") {
    if (!env.WIX_API_KEY) erroWix = "Falta a chave do Wix (WIX_API_KEY) para comparar com o sistema antigo.";
    else { try { divergencias = await divergenciasWix(env, pessoas); } catch (e) { erroWix = e.message; } }
  }
  const pendPartes = await partesSemCadastro(env);
  const avisos = { parte: "Pessoa registrada como parte contrária do processo; o processo agora aparece também na ficha dela.",
    partes: `${url.searchParams.get("l") || 0} processo(s) ligados ao cadastro da parte contrária (${url.searchParams.get("c") || 0} cadastro(s) novo(s) de Parte Adversa).`, corrigido: `${url.searchParams.get("n") || 0} vínculo(s) corrigido(s).${url.searchParams.get("m") ? ` ${url.searchParams.get("m")}` : ""}`, unificado: "Cadastros unificados. Tudo o que estava no duplicado agora está no cadastro principal.", distintos: "Par marcado como pessoas diferentes; não será sugerido de novo." };
  const erros = { sessao: "Sessão expirada. Tente novamente.", erro: `Não foi possível concluir.${url.searchParams.get("m") ? ` ${url.searchParams.get("m")}` : ""}` };

  const resumoPessoa = (c) => html`<div class="pessoa-par">
      <a href="/sistema/clientes/${String(c.id)}"><strong>${c.nome}</strong></a>
      <small>${c.vinculo || (c.cliente ? "Cliente" : "")}${c.docTexto ? ` · ${mascararDoc(c.docTexto)}` : ""}${c.wix_id ? " · veio do Wix" : ""}</small>
      <small>${String(c.n_proc)} processo(s) como cliente${c.n_parte ? ` · ${c.n_parte} como parte contrária` : ""} · ${String(c.n_fin)} lançamento(s) · ${String(c.n_hist)} andamento(s)</small>
    </div>`;
  const botaoUnir = (principal, dup) => html`<form method="post" data-confirmar="${`Unificar: “${dup.nome}” será incorporado a “${principal.nome}” (processos, financeiro, histórico e CRM passam para ele) e o cadastro “${dup.nome}” será apagado. Continuar?`}">${campoCsrf(sessao)}
      <input type="hidden" name="principal" value="${String(principal.id)}"><input type="hidden" name="duplicado" value="${String(dup.id)}">
      <button type="submit" name="acao" value="unificar" class="botao-pequeno">Manter “${principal.nome}”</button></form>`;

  return resposta(pagina({
    titulo: "Verificação de cadastros", sessao, ...(avisos[msg] ? { aviso: avisos[msg] } : {}), ...(erros[msg] ? { erro: erros[msg] } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/configuracoes">Configurações</a></p><h1>Verificação de cadastros</h1>
      <section class="cartao"><h2>Vínculos processo × cliente (comparação com o Wix)</h2>
        <p class="dica">No sistema antigo, os andamentos e lançamentos guardam por escrito o nome de uma pessoa. A comparação aponta os processos em que esse nome não é nem o cliente
          nem uma parte contrária registrada. <strong>É parte contrária</strong> liga a pessoa ao processo como parte adversa (o processo passa a aparecer na ficha dela).
          <strong>É o cliente</strong> troca o cliente do processo (andamentos, lançamentos e pasta no SharePoint acompanham).</p>
        ${pendPartes ? html`<div class="aviso-organizar"><p><strong>${String(pendPartes)}</strong> processo(s) têm a parte contrária só como texto, sem ligação com o cadastro de pessoas.
            Vincular usa o cadastro com o mesmo nome ou cria um com vínculo "Parte Adversa", e o processo passa a aparecer também na ficha da parte.</p>
          <form method="post">${campoCsrf(sessao)}<button type="submit" name="acao" value="vincular_partes">Vincular partes contrárias aos cadastros</button></form></div>` : ""}
        ${divergencias === null && !erroWix ? html`<p><a class="botao-link" href="/sistema/verificacao?wix=1">Comparar com o Wix</a></p>` : ""}
        ${erroWix ? html`<p class="erro">${erroWix}</p>` : ""}
        ${divergencias && !divergencias.length ? html`<p>✓ Nenhuma divergência: o cliente de cada processo confere com os registros do sistema antigo.</p>` : ""}
        ${divergencias?.length ? html`<div class="tabela-rolagem"><table>
            <thead><tr><th>Processo</th><th>Cliente vinculado</th><th>Cliente nos registros do Wix</th><th></th></tr></thead>
            <tbody>${divergencias.map((d) => html`<tr>
              <td><a href="/sistema/processos/${String(d.proc.id)}">${d.proc.pasta ? `Pasta ${d.proc.pasta}` : ""} ${d.proc.numero || ""}</a></td>
              <td>${d.proc.cliente || "—"}</td>
              <td>${d.citado} <small>(${String(d.vezes)} registro(s))</small>${d.sugerido ? "" : html`<br><small>não há cadastro com esse nome</small>`}</td>
              <td class="acoes-vinculo"><form method="post">${campoCsrf(sessao)}<input type="hidden" name="processo" value="${String(d.proc.id)}"><input type="hidden" name="nome" value="${d.sugerido?.nome || d.citado}">
                  <button type="submit" name="acao" value="parte" class="botao-pequeno">É parte contrária</button></form>
                ${d.sugerido ? html`<form method="post" data-confirmar="${`Trocar o cliente do processo ${d.proc.pasta ? `da pasta ${d.proc.pasta}` : ""} para “${d.sugerido.nome}”?`}">${campoCsrf(sessao)}
                  <input type="hidden" name="processo" value="${String(d.proc.id)}"><input type="hidden" name="pessoa" value="${String(d.sugerido.id)}">
                  <button type="submit" name="acao" value="corrigir" class="botao-secundario botao-pequeno">É o cliente</button></form>` : ""}</td></tr>`)}</tbody></table></div>
` : ""}
      </section>
      <section class="cartao"><h2>Possíveis cadastros duplicados (${String(lista.length)})</h2>
        <p class="dica">Pessoas com o mesmo CPF/CNPJ, nome, e-mail ou telefone, ou com uma palavra pouco comum em comum no nome (ex.: razão social e nome fantasia).
          Ao unificar, escolha o cadastro que fica: processos, lançamentos, histórico, agenda e CRM do outro passam para ele, os campos vazios são completados e o outro é apagado.
          A importação do Wix não recria o cadastro apagado.</p>
        ${lista.length ? html`<ul class="lista-pares">${lista.map((x) => html`<li class="par-duplicado">
            <p class="motivos">${[...x.motivos].join(" · ")}</p>
            <div class="par-colunas">${resumoPessoa(x.a)}${resumoPessoa(x.b)}</div>
            <div class="botoes-form">${botaoUnir(x.a, x.b)}${botaoUnir(x.b, x.a)}
              <form method="post">${campoCsrf(sessao)}<input type="hidden" name="a" value="${String(x.a.id)}"><input type="hidden" name="b" value="${String(x.b.id)}">
                <button type="submit" name="acao" value="distintos" class="botao-secundario botao-pequeno">Não são a mesma pessoa</button></form></div>
          </li>`)}</ul>` : html`<p>✓ Nenhum possível duplicado encontrado.</p>`}
      </section>
      <section class="cartao"><h2>Clientes sem processo (${String(semProcesso.length)})</h2>
        <p class="dica">Cadastros com vínculo "Cliente" sem nenhum processo. Podem ser clientes de consultoria, contatos antigos, duplicados não detectados acima, ou processos ligados por engano a outro cadastro.</p>
        ${semProcesso.length ? html`<ul class="lista-simples">${semProcesso.map((c) => html`<li><a href="/sistema/clientes/${String(c.id)}">${c.nome}</a>
            <span>${c.n_fin ? `${c.n_fin} lançamento(s) · ` : ""}<a href="/sistema/processos/novo?cliente=${String(c.id)}">Novo processo</a></span></li>`)}</ul>` : html`<p>✓ Todos os clientes têm processo.</p>`}
      </section>
      <section class="cartao"><h2>Processos sem cliente (${String(semCliente.length)})</h2>
        ${semCliente.length ? html`<ul class="lista-simples">${semCliente.map((p) => html`<li><a href="/sistema/processos/${String(p.id)}">${p.pasta ? `Pasta ${p.pasta} · ` : ""}${p.numero || "sem número"}</a>
            <span>${p.parte_contraria || ""} · <a href="/sistema/processos/${String(p.id)}/editar">Definir cliente</a></span></li>`)}</ul>` : html`<p>✓ Todos os processos têm cliente.</p>`}
      </section>
      <script src="/assets/js/confirmar.js" defer></script>`,
  }));
}
