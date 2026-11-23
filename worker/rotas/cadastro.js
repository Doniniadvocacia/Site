// Cadastro e edição de clientes e processos (toda a equipe).
// Campos sensíveis continuam cifrados; registros editados aqui deixam de ser sobrescritos pela importação do Wix.
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora, cifrar, decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { opcoes, csrfOk, txt, dataValida, numeroBR } from "./comum.js";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map((u) => [u, u]);
const lista = (...v) => v.map((x) => [x, x]);
const naoEncontrado = (sessao) => resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Registro não encontrado</h1>` }), 404);
const datalist = (id, valores) => html`<datalist id="${id}">${valores.map((v) => html`<option value="${v}">`)}</datalist>`;

// Valores já usados no banco, para sugerir no preenchimento.
async function usados(env, tabela, coluna) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT TRIM(${coluna}) AS v FROM ${tabela} WHERE COALESCE(TRIM(${coluna}), '') != '' ORDER BY 1 LIMIT 100`).all();
  return results.map((r) => r.v);
}

// ---------- Clientes ----------
const CAMPOS_CLIENTE_ENC = ["documento", "data_nascimento", "email", "telefone", "endereco", "observacoes"];

function formularioCliente(sessao, c, acao, sugestoes) {
  return html`<form method="post" action="${acao}" class="formulario grade-form">
    ${campoCsrf(sessao)}
    <label class="largo">Nome<input name="nome" required maxlength="200" value="${c.nome || ""}"></label>
    <label>Tipo<select name="tipo">${opcoes(lista("Pessoa Física", "Pessoa Jurídica"), c.tipo)}</select></label>
    <label>CPF/CNPJ<input name="documento" maxlength="30" value="${c.documento || ""}" inputmode="numeric"></label>
    <label>Nascimento/fundação<input name="data_nascimento" maxlength="20" value="${c.data_nascimento || ""}" placeholder="dd/mm/aaaa"></label>
    <label>Posição<input name="posicao" maxlength="60" value="${c.posicao || ""}" list="posicoes"></label>
    <label>E-mail<input name="email" type="email" maxlength="200" value="${c.email || ""}"></label>
    <label>Telefone<input name="telefone" maxlength="40" value="${c.telefone || ""}" inputmode="tel"></label>
    <label>Profissão<input name="profissao" maxlength="100" value="${c.profissao || ""}"></label>
    <label>Estado civil<select name="estado_civil">${opcoes(lista("Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"), c.estado_civil)}</select></label>
    <label>Gênero<select name="genero">${opcoes(lista("Masculino", "Feminino", "Outro"), c.genero)}</select></label>
    <label class="largo">Endereço (rua, número, bairro, CEP)<input name="endereco" maxlength="400" value="${c.endereco || ""}"></label>
    <label>Cidade<input name="cidade" maxlength="100" value="${c.cidade || ""}"></label>
    <label>UF<select name="estado">${opcoes(UFS, c.estado)}</select></label>
    <label>Data de cadastro<input type="date" name="data_cadastro" value="${c.data_cadastro || ""}"></label>
    <label class="largo">Observações<textarea name="observacoes" rows="3" maxlength="4000">${c.observacoes || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit">Salvar cliente</button></div>
    ${datalist("posicoes", sugestoes.posicoes)}
  </form>
  <p class="dica">CPF/CNPJ, nascimento, contatos, endereço e observações são gravados cifrados.</p>`;
}

export async function cadastroCliente(req, env, sessao, id) {
  const existente = id ? await env.DB.prepare("SELECT * FROM clientes WHERE id = ?").bind(Number(id)).first() : null;
  if (id && !existente) return naoEncontrado(sessao);
  const acao = id ? `/sistema/clientes/${id}/editar` : "/sistema/clientes/novo";
  const sugestoes = { posicoes: [...new Set(["Autor", "Réu", ...(await usados(env, "clientes", "posicao"))])] };
  const tela = (c, erro) => resposta(pagina({
    titulo: id ? `Editar ${existente.nome}` : "Novo cliente", sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/clientes">Clientes</a>${id ? html` › <a href="/sistema/clientes/${id}">${existente.nome}</a>` : ""}</p>
      <h1>${id ? "Editar cliente" : "Novo cliente"}</h1>
      <section class="cartao">${formularioCliente(sessao, c, acao, sugestoes)}</section>`,
  }));
  if (req.method === "GET") {
    if (!existente) return tela({ tipo: "Pessoa Física", data_cadastro: new Date().toISOString().slice(0, 10) });
    const c = { ...existente };
    const dec = await Promise.all(CAMPOS_CLIENTE_ENC.map((k) => decifrar(env, existente[`${k}_enc`])));
    CAMPOS_CLIENTE_ENC.forEach((k, i) => (c[k] = dec[i]));
    return tela(c);
  }
  const { f, ok } = await csrfOk(req, sessao);
  const c = {
    nome: txt(f, "nome", 200), tipo: txt(f, "tipo", 40), posicao: txt(f, "posicao", 60), genero: txt(f, "genero", 30),
    estado_civil: txt(f, "estado_civil", 40), profissao: txt(f, "profissao", 100), cidade: txt(f, "cidade", 100), estado: txt(f, "estado", 2),
    data_cadastro: dataValida(txt(f, "data_cadastro")),
  };
  CAMPOS_CLIENTE_ENC.forEach((k) => (c[k] = txt(f, k, k === "observacoes" ? 4000 : 400)));
  if (!ok) return tela(c, "Sessão expirada. Tente novamente.");
  if (!c.nome) return tela(c, "Informe o nome do cliente.");
  const enc = await Promise.all(CAMPOS_CLIENTE_ENC.map((k) => cifrar(env, c[k])));
  const t = agora();
  const v = [c.nome, c.tipo, c.posicao, c.genero, c.estado_civil, c.profissao, c.cidade, c.estado, ...enc, c.data_cadastro, t];
  let novoId = existente?.id;
  if (existente) {
    await env.DB.prepare(`UPDATE clientes SET nome=?1, tipo=?2, posicao=?3, genero=?4, estado_civil=?5, profissao=?6, cidade=?7, estado=?8,
      documento_enc=?9, data_nascimento_enc=?10, email_enc=?11, telefone_enc=?12, endereco_enc=?13, observacoes_enc=?14, data_cadastro=?15,
      atualizado_em=?16, editado_local=1 WHERE id=?17`).bind(...v, existente.id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO clientes (nome, tipo, posicao, genero, estado_civil, profissao, cidade, estado, documento_enc,
      data_nascimento_enc, email_enc, telefone_enc, endereco_enc, observacoes_enc, data_cadastro, atualizado_em, criado_em, editado_local)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16,1)`).bind(...v).run();
    novoId = r.meta.last_row_id;
  }
  await auditar(env, req, sessao.usuario_id, existente ? "cliente_alterado" : "cliente_criado", `cliente ${novoId}`);
  return redirecionar(`/sistema/clientes/${novoId}?salvo=1`);
}

// ---------- Processos ----------
const FASES = ["Aguarda Citação", "Conhecimento", "Instrução", "Sentencial", "Recursal", "Cumprimento de Sentença", "Trânsito em Julgado"];
const RESULTADOS = ["Procedente", "Parcialmente Procedente", "Improcedente", "Extinto s/ Resolução de Mérito", "Acordo"];
const TEXTOS_PROC = {
  pasta: 20, numero: 40, tipo_acao: 150, rito: 60, fase: 60, instancia: 40, situacao: 60, competencia: 60, comarca: 100, vara: 100, uf: 2,
  posicao_cliente: 60, parte_contraria: 200, advogado_parte_contraria: 200, advogado_responsavel: 120, ajg_deferida: 20,
  resultado: 60, resultado_atual: 60, resultado_primeira: 60, resultado_segunda: 60, resultado_superior: 60,
};
const DATAS_PROC = ["data_distribuicao", "data_cadastro", "data_decisao_primeira", "data_decisao_segunda", "data_decisao_superior", "data_decisao_final"];

function formularioProcesso(sessao, p, acao, apoio) {
  const t = (nome, rotulo, extra = {}) => html`<label class="${extra.largo ? "largo" : ""}">${rotulo}<input name="${nome}" maxlength="${String(TEXTOS_PROC[nome] || 200)}" value="${p[nome] || ""}"${extra.list ? html` list="${extra.list}"` : ""}${extra.required ? html` required` : ""}></label>`;
  const d = (nome, rotulo) => html`<label>${rotulo}<input type="date" name="${nome}" value="${p[nome] || ""}"></label>`;
  return html`<form method="post" action="${acao}" class="formulario grade-form">
    ${campoCsrf(sessao)}
    <label class="largo">Cliente<select name="cliente_id">${opcoes(apoio.clientes, p.cliente_id, "Selecione o cliente")}</select></label>
    ${t("pasta", "Pasta")}${t("numero", "Número do processo")}
    ${t("tipo_acao", "Tipo de ação", { list: "l-acao" })}${t("rito", "Rito", { list: "l-rito" })}
    <label>Fase<input name="fase" maxlength="60" value="${p.fase || ""}" list="l-fase"></label>
    ${t("instancia", "Instância", { list: "l-instancia" })}${t("situacao", "Situação", { list: "l-situacao" })}${t("competencia", "Competência", { list: "l-competencia" })}
    ${t("comarca", "Comarca")}${t("vara", "Vara")}
    <label>UF<select name="uf">${opcoes(UFS, p.uf)}</select></label>
    ${t("posicao_cliente", "Posição do cliente", { list: "l-posicao" })}
    ${t("advogado_responsavel", "Advogado responsável", { list: "l-advogado" })}
    <label>AJG deferida<select name="ajg_deferida">${opcoes(lista("Sim", "Não", "Pendente"), p.ajg_deferida)}</select></label>
    <label>Valor da causa (R$)<input name="valor_causa" inputmode="decimal" value="${p.valor_causa ?? ""}" placeholder="0,00"></label>
    ${d("data_distribuicao", "Distribuição")}${d("data_cadastro", "Cadastro")}
    <fieldset class="largo grade-form"><legend>Parte contrária</legend>
      ${t("parte_contraria", "Nome")}${t("advogado_parte_contraria", "Advogado")}
      <label class="largo">Contato (e-mail, telefone)<input name="contato" maxlength="400" value="${p.contato || ""}"></label>
    </fieldset>
    <fieldset class="largo grade-form"><legend>Resultados</legend>
      ${t("resultado", "Resultado", { list: "l-resultado" })}${t("resultado_atual", "Resultado atual", { list: "l-resultado" })}
      ${t("resultado_primeira", "1ª instância", { list: "l-resultado" })}${d("data_decisao_primeira", "Data (1ª)")}
      ${t("resultado_segunda", "2ª instância", { list: "l-resultado" })}${d("data_decisao_segunda", "Data (2ª)")}
      ${t("resultado_superior", "Instância superior", { list: "l-resultado" })}${d("data_decisao_superior", "Data (superior)")}
      ${d("data_decisao_final", "Decisão final")}
    </fieldset>
    <label class="largo">Observações<textarea name="observacoes" rows="3" maxlength="4000">${p.observacoes || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit">Salvar processo</button></div>
    ${datalist("l-acao", apoio.acoes)}${datalist("l-rito", apoio.ritos)}${datalist("l-fase", apoio.fases)}${datalist("l-instancia", apoio.instancias)}
    ${datalist("l-situacao", apoio.situacoes)}${datalist("l-competencia", apoio.competencias)}${datalist("l-posicao", apoio.posicoes)}
    ${datalist("l-advogado", apoio.advogados)}${datalist("l-resultado", apoio.resultados)}
  </form>
  <p class="dica">Contato da parte contrária e observações são gravados cifrados.</p>`;
}


export async function cadastroProcesso(req, env, sessao, id) {
  const existente = id ? await env.DB.prepare("SELECT * FROM processos WHERE id = ?").bind(Number(id)).first() : null;
  if (id && !existente) return naoEncontrado(sessao);
  const acao = id ? `/sistema/processos/${id}/editar` : "/sistema/processos/novo";
  const [clientes, acoes, ritos, fases, instancias, situacoes, competencias, posicoes, advogados, resultados] = await Promise.all([
    env.DB.prepare("SELECT id, nome FROM clientes ORDER BY nome COLLATE NOCASE").all(),
    ...["tipo_acao", "rito", "fase", "instancia", "situacao", "competencia", "posicao_cliente", "advogado_responsavel", "resultado"].map((c) => usados(env, "processos", c)),
  ]);
  const apoio = {
    clientes: clientes.results.map((c) => [c.id, c.nome]), acoes, ritos, instancias, competencias, advogados,
    fases: [...new Set([...FASES, ...fases])], situacoes: [...new Set(["Ativo", "Suspenso", "Arquivado", ...situacoes])],
    posicoes: [...new Set(["Autor", "Réu", ...posicoes])], resultados: [...new Set([...RESULTADOS, ...resultados])],
  };
  const titulo = existente ? (existente.numero || `Pasta ${existente.pasta}`) : "Novo processo";
  const tela = (p, erro) => resposta(pagina({
    titulo: id ? `Editar ${titulo}` : titulo, sessao, erro,
    corpo: html`<p class="trilha"><a href="/sistema/processos">Processos</a>${id ? html` › <a href="/sistema/processos/${id}">${titulo}</a>` : ""}</p>
      <h1>${id ? "Editar processo" : "Novo processo"}</h1>
      <section class="cartao">${formularioProcesso(sessao, p, acao, apoio)}</section>`,
  }));
  if (req.method === "GET") {
    if (!existente) {
      const proxima = await env.DB.prepare("SELECT MAX(CAST(pasta AS INTEGER)) AS n FROM processos").first();
      const cli = Number(new URL(req.url).searchParams.get("cliente")) || null;
      return tela({ cliente_id: cli, pasta: String((proxima?.n || 0) + 1).padStart(4, "0"), situacao: "Ativo", data_cadastro: new Date().toISOString().slice(0, 10), uf: "RS" });
    }
    const [contato, observacoes] = await Promise.all([decifrar(env, existente.contato_parte_contraria_enc), decifrar(env, existente.observacoes_enc)]);
    return tela({ ...existente, contato, observacoes });
  }
  const { f, ok } = await csrfOk(req, sessao);
  const p = { cliente_id: Number(f.get("cliente_id")) || null, contato: txt(f, "contato", 400), observacoes: txt(f, "observacoes", 4000) };
  for (const [k, max] of Object.entries(TEXTOS_PROC)) p[k] = txt(f, k, max);
  for (const k of DATAS_PROC) p[k] = dataValida(txt(f, k));
  p.valor_causa = numeroBR(f.get("valor_causa"));
  if (!ok) return tela(p, "Sessão expirada. Tente novamente.");
  if (!p.cliente_id || (!p.numero && !p.pasta)) return tela(p, "Informe o cliente e o número do processo ou a pasta.");
  if (Number.isNaN(p.valor_causa)) return tela(p, "Valor da causa inválido. Use o formato 15.000,50.");
  const dup = p.numero ? await env.DB.prepare("SELECT id FROM processos WHERE numero = ? AND id != ?").bind(p.numero, existente?.id || 0).first() : null;
  if (dup) return tela(p, "Já existe um processo com esse número.");
  const colunas = ["cliente_id", ...Object.keys(TEXTOS_PROC), ...DATAS_PROC, "valor_causa"];
  const valores = colunas.map((k) => p[k] ?? null);
  const [contatoEnc, obsEnc] = await Promise.all([cifrar(env, p.contato), cifrar(env, p.observacoes)]);
  const t = agora();
  let novoId = existente?.id;
  if (existente) {
    await env.DB.prepare(`UPDATE processos SET ${colunas.map((c) => `${c} = ?`).join(", ")}, contato_parte_contraria_enc = ?, observacoes_enc = ?,
      atualizado_em = ?, editado_local = 1 WHERE id = ?`).bind(...valores, contatoEnc, obsEnc, t, existente.id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO processos (${colunas.join(", ")}, contato_parte_contraria_enc, observacoes_enc, criado_em, atualizado_em, editado_local)
      VALUES (${colunas.map(() => "?").join(", ")}, ?, ?, ?, ?, 1)`).bind(...valores, contatoEnc, obsEnc, t, t).run();
    novoId = r.meta.last_row_id;
  }
  await auditar(env, req, sessao.usuario_id, existente ? "processo_alterado" : "processo_criado", `processo ${novoId}`);
  return redirecionar(`/sistema/processos/${novoId}?salvo=1`);
}
