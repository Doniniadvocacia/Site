// Painel, clientes e processos (consulta). Na etapa 1 os dados vêm do Wix e são só para leitura.
import { html, pagina, resposta, dataBR, moeda } from "../html.js";
import { decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";

const naoEncontrado = (sessao) => resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Registro não encontrado</h1>` }), 404);
const campo = (rotulo, valor) => (valor ? html`<div><dt>${rotulo}</dt><dd>${valor}</dd></div>` : "");
// Cartão com ficha; some quando não há nenhum campo preenchido.
const secao = (titulo, campos, extra = "") => {
  const cheios = campos.filter((c) => c !== "");
  if (!cheios.length && !extra) return "";
  return html`<section class="cartao">${titulo ? html`<h2>${titulo}</h2>` : ""}${cheios.length ? html`<dl class="ficha">${cheios}</dl>` : ""}${extra}</section>`;
};

export async function painel(req, env, sessao) {
  const [c, p, ultimaImport] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM clientes").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM processos").first(),
    env.DB.prepare("SELECT criado_em, detalhe FROM auditoria WHERE acao = 'importacao_wix' ORDER BY id DESC LIMIT 1").first(),
  ]);
  const { results: situacoes } = await env.DB.prepare(
    "SELECT COALESCE(NULLIF(situacao, ''), 'Sem situação') AS s, COUNT(*) AS n FROM processos GROUP BY 1 ORDER BY n DESC"
  ).all();
  return resposta(pagina({
    titulo: "Painel", sessao,
    corpo: html`
      <h1>Olá, ${sessao.nome.split(" ")[0]}</h1>
      <div class="indicadores">
        <a class="indicador" href="/sistema/clientes"><strong>${String(c.n)}</strong><span>clientes</span></a>
        <a class="indicador" href="/sistema/processos"><strong>${String(p.n)}</strong><span>processos</span></a>
      </div>
      ${situacoes.length ? html`<section class="cartao"><h2>Processos por situação</h2>
        <ul class="lista-simples">${situacoes.map((s) => html`<li><a href="/sistema/processos?situacao=${encodeURIComponent(s.s)}">${s.s}</a> <span>${String(s.n)}</span></li>`)}</ul>
      </section>` : ""}
      <p class="dica">Etapa 1 da migração: dados importados do Wix, somente para consulta.
        ${ultimaImport ? html`Última importação em ${new Date(ultimaImport.criado_em * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "Nenhuma importação feita ainda."}</p>`,
  }));
}

export async function clientes(req, env, sessao, id) {
  if (!id) {
    const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.nome, c.tipo, c.cidade, c.estado, COUNT(p.id) AS processos
         FROM clientes c LEFT JOIN processos p ON p.cliente_id = c.id
        WHERE c.nome LIKE ? GROUP BY c.id ORDER BY c.nome COLLATE NOCASE LIMIT 500`
    ).bind(`%${q}%`).all();
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
    let sql = `SELECT p.id, p.pasta, p.numero, p.tipo_acao, p.situacao, p.fase, p.comarca, p.uf, c.nome AS cliente
                 FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id
                WHERE (p.numero LIKE ?1 OR p.pasta LIKE ?1 OR c.nome LIKE ?1 OR p.parte_contraria LIKE ?1)`;
    const args = [`%${q}%`];
    if (situacao) {
      sql += situacao === "Sem situação" ? " AND COALESCE(p.situacao, '') = ''" : " AND p.situacao = ?2";
      if (situacao !== "Sem situação") args.push(situacao);
    }
    sql += " ORDER BY CAST(p.pasta AS INTEGER), p.pasta LIMIT 500";
    const { results } = await env.DB.prepare(sql).bind(...args).all();
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
`,
  }));
}
