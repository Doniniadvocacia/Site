// Cadastro e edição de clientes e processos (toda a equipe).
// Campos sensíveis continuam cifrados; registros editados aqui deixam de ser sobrescritos pela importação do Wix.
import { html, pagina, resposta, redirecionar, campoCsrf } from "../html.js";
import { agora, cifrar, decifrar } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { opcoes, csrfOk, txt, dataValida, numeroBR, soDigitos, cpfValido, cnpjValido, formatarCpf, formatarCnpj, formatarFone, formatarCep, enderecoTexto } from "./comum.js";

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
    <label>CPF/CNPJ<input name="documento" maxlength="18" value="${c.documento || ""}" inputmode="numeric" data-mascara="documento"></label>
    <label>Nascimento/fundação<input name="data_nascimento" maxlength="20" value="${c.data_nascimento || ""}" placeholder="dd/mm/aaaa"></label>
    <label>Posição<input name="posicao" maxlength="60" value="${c.posicao || ""}" list="posicoes"></label>
    <label>E-mail<input name="email" type="email" maxlength="200" value="${c.email || ""}"></label>
    <label>Telefone<input name="telefone" maxlength="15" value="${c.telefone || ""}" inputmode="tel" data-mascara="fone" placeholder="(XX) XXXXX-XXXX"></label>
    <label>Profissão<input name="profissao" maxlength="100" value="${c.profissao || ""}"></label>
    <label>Estado civil<select name="estado_civil">${opcoes(lista("Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"), c.estado_civil)}</select></label>
    <label>Gênero<select name="genero">${opcoes(lista("Masculino", "Feminino", "Outro"), c.genero)}</select></label>
    <fieldset class="largo grade-form grupo-form grupo-endereco"><legend>Endereço</legend>
      ${c.endereco_antigo ? html`<p class="dica largo">Endereço registrado anteriormente: <strong>${c.endereco_antigo}</strong>. Preencha os campos abaixo para atualizar.</p>` : ""}
      <label>CEP<input name="cep" maxlength="9" inputmode="numeric" data-mascara="cep" data-endereco="cep" value="${c.cep || ""}" placeholder="XXXXX-XXX"></label>
      <label class="duplo">Rua<input name="rua" maxlength="150" data-endereco="rua" value="${c.rua || ""}"></label>
      <label>Número<input name="numero" maxlength="15" data-endereco="numero" value="${c.numero || ""}"></label>
      <label>Complemento<input name="complemento" maxlength="80" data-endereco="complemento" value="${c.complemento || ""}" placeholder="Apto, sala, bloco"></label>
      <label>Bairro<input name="bairro" maxlength="80" data-endereco="bairro" value="${c.bairro || ""}"></label>
      <label>Cidade<input name="cidade" maxlength="100" data-endereco="cidade" value="${c.cidade || ""}"></label>
      <label>Estado<select name="estado" data-endereco="uf">${opcoes(UFS, c.estado)}</select></label>
    </fieldset>
    <label>Data de cadastro<input type="date" name="data_cadastro" value="${c.data_cadastro || ""}"></label>
    <label class="largo">Observações<textarea name="observacoes" rows="3" maxlength="4000">${c.observacoes || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit">Salvar cliente</button></div>
    ${datalist("posicoes", sugestoes.posicoes)}
  </form>
  <p class="dica">CPF/CNPJ, nascimento, contatos, endereço e observações são gravados cifrados.</p>
  <script src="/assets/js/mascaras.js" defer></script><script src="/assets/js/cep.js" defer></script>`;
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
    let dados = {};
    try { dados = JSON.parse((await decifrar(env, existente.endereco_dados_enc)) || "{}"); } catch { /* sem endereço estruturado */ }
    Object.assign(c, dados);
    if (!Object.keys(dados).length && c.endereco) c.endereco_antigo = c.endereco;
    return tela(c);
  }
  const { f, ok } = await csrfOk(req, sessao);
  const c = {
    nome: txt(f, "nome", 200), tipo: txt(f, "tipo", 40), posicao: txt(f, "posicao", 60), genero: txt(f, "genero", 30),
    estado_civil: txt(f, "estado_civil", 40), profissao: txt(f, "profissao", 100), cidade: txt(f, "cidade", 100), estado: txt(f, "estado", 2),
    data_cadastro: dataValida(txt(f, "data_cadastro")),
  };
  CAMPOS_CLIENTE_ENC.forEach((k) => (c[k] = txt(f, k, k === "observacoes" ? 4000 : 400)));
  Object.assign(c, { cep: txt(f, "cep", 9), rua: txt(f, "rua", 150), numero: txt(f, "numero", 15), complemento: txt(f, "complemento", 80), bairro: txt(f, "bairro", 80) });
  if (!ok) return tela(c, "Sessão expirada. Tente novamente.");
  if (!c.nome) return tela(c, "Informe o nome do cliente.");
  // Documento: valida CPF/CNPJ quando informado ou alterado (registros antigos fora do padrão continuam aceitos se não forem mexidos).
  const docAntigo = existente ? await decifrar(env, existente.documento_enc) : "";
  if (c.documento && c.documento !== docAntigo) {
    const d = soDigitos(c.documento);
    if (d.length === 11 && cpfValido(d)) c.documento = formatarCpf(d);
    else if (d.length === 14 && cnpjValido(d)) c.documento = formatarCnpj(d);
    else return tela(c, "CPF ou CNPJ inválido.");
  }
  if (c.telefone) { const d = soDigitos(c.telefone); if (d.length !== 10 && d.length !== 11) return tela(c, "Telefone: use (XX) XXXX-XXXX ou (XX) XXXXX-XXXX."); c.telefone = formatarFone(d); }
  if (c.cep) { const d = soDigitos(c.cep); if (d.length !== 8) return tela(c, "CEP: use XXXXX-XXX."); c.cep = formatarCep(d); }
  const enderecoDados = Object.fromEntries(["rua", "numero", "complemento", "bairro", "cep"].filter((k) => c[k]).map((k) => [k, c[k]]));
  if (Object.keys(enderecoDados).length) c.endereco = enderecoTexto({ ...enderecoDados, cidade: c.cidade, uf: c.estado });
  const enc = await Promise.all(CAMPOS_CLIENTE_ENC.map((k) => cifrar(env, c[k])));
  let endDadosEnc = null;
  if (Object.keys(enderecoDados).length) endDadosEnc = await cifrar(env, JSON.stringify(enderecoDados));
  else if (existente && !existente.endereco_dados_enc) enc[CAMPOS_CLIENTE_ENC.indexOf("endereco")] = existente.endereco_enc; // mantém o endereço antigo (texto)
  const t = agora();
  const v = [c.nome, c.tipo, c.posicao, c.genero, c.estado_civil, c.profissao, c.cidade, c.estado, ...enc, c.data_cadastro, t];
  let novoId = existente?.id;
  if (existente) {
    await env.DB.prepare(`UPDATE clientes SET nome=?1, tipo=?2, posicao=?3, genero=?4, estado_civil=?5, profissao=?6, cidade=?7, estado=?8,
      documento_enc=?9, data_nascimento_enc=?10, email_enc=?11, telefone_enc=?12, endereco_enc=?13, observacoes_enc=?14, data_cadastro=?15,
      atualizado_em=?16, editado_local=1, endereco_dados_enc=?18 WHERE id=?17`).bind(...v, existente.id, endDadosEnc).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO clientes (nome, tipo, posicao, genero, estado_civil, profissao, cidade, estado, documento_enc,
      data_nascimento_enc, email_enc, telefone_enc, endereco_enc, observacoes_enc, data_cadastro, atualizado_em, criado_em, editado_local, endereco_dados_enc)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16,1,?17)`).bind(...v, endDadosEnc).run();
    novoId = r.meta.last_row_id;
  }
  await auditar(env, req, sessao.usuario_id, existente ? "cliente_alterado" : "cliente_criado", `cliente ${novoId}`);
  return redirecionar(`/sistema/clientes/${novoId}?salvo=1`);
}

// ---------- Processos ----------
// Opções iguais às do Diligo no Wix; valores já usados no banco também são sugeridos.
const FASES = ["Aguarda Citação", "Conhecimento", "Instrução", "Sentencial", "Recursal", "Cumprimento de Sentença", "Suspenso", "Aguarda Arquivamento", "Arquivado"];
const RESULTADOS = ["Procedente", "Parcialmente Procedente", "Improcedente", "Extinto sem Resolução do Mérito", "Acordo Homologado", "Recurso Provido", "Recurso Parcialmente Provido", "Recurso não Provido"];
const MOTIVOS = ["Procedência da Ação", "Parcial Procedência da Ação", "Improcedência da Ação", "Acordo", "Pagamento Condenação", "Extinto S/ Resolução do Mérito", "Desistência", "Revogação de Mandato"];
const TEXTOS_PROC = {
  pasta: 20, numero: 40, tipo_acao: 150, rito: 60, fase: 60, instancia: 40, situacao: 60, competencia: 60, comarca: 100, vara: 120, numero_vara: 20, uf: 2,
  posicao_cliente: 60, parte_contraria: 200, advogado_parte_contraria: 200, oab_parte_contraria: 30, advogado_responsavel: 120, ajg_deferida: 20,
  resultado: 60, resultado_atual: 60, resultado_primeira: 60, resultado_segunda: 60, resultado_superior: 60, motivo_encerramento: 80,
};
const DATAS_PROC = ["data_distribuicao", "data_cadastro", "data_citacao", "data_transito", "data_encerramento",
  "data_decisao_primeira", "data_decisao_segunda", "data_decisao_superior", "data_decisao_final"];

function formularioProcesso(sessao, p, acao, apoio) {
  const t = (nome, rotulo, extra = {}) => html`<label class="${extra.largo ? "largo" : ""}">${rotulo}<input name="${nome}" maxlength="${String(TEXTOS_PROC[nome] || 200)}" value="${p[nome] || ""}"${extra.list ? html` list="${extra.list}"` : ""}${extra.placeholder ? html` placeholder="${extra.placeholder}"` : ""}></label>`;
  const d = (nome, rotulo) => html`<label>${rotulo}<input type="date" name="${nome}" value="${p[nome] || ""}"></label>`;
  const s = (nome, rotulo, lista, vazio = "—") => html`<label>${rotulo}<select name="${nome}">${opcoes([...new Set([...lista, ...(p[nome] ? [p[nome]] : [])])].map((v) => [v, v]), p[nome], vazio)}</select></label>`;
  const grupo = (titulo, corpo, extra = "") => html`<fieldset class="largo grade-form grupo-form ${extra}"><legend>${titulo}</legend>${corpo}</fieldset>`;
  return html`<form method="post" action="${acao}" class="formulario grade-form">
    ${campoCsrf(sessao)}
    ${grupo("Dados da Pasta", html`
      ${t("pasta", "Pasta")}
      ${t("advogado_responsavel", "Adv. responsável", { list: "l-advogado" })}
      <label class="duplo">Cliente<select name="cliente_id">${opcoes(apoio.clientes, p.cliente_id, "Selecione o cliente")}</select></label>
      ${s("posicao_cliente", "Posição do cliente", apoio.posicoes)}
      ${s("ajg_deferida", "AJG deferida", ["Sim", "Não", "Pendente"])}
      <label class="duplo">Parte contrária<input name="parte_contraria" maxlength="200" value="${p.parte_contraria || ""}"></label>
      ${d("data_cadastro", "Data de cadastro")}
      ${t("tipo_acao", "Tipo de ação", { list: "l-acao" })}
      ${s("situacao", "Status da pasta", apoio.situacoes)}`)}
    ${grupo("Dados do Processo", html`
      <label class="duplo">Número do processo (CNJ)<input name="numero" maxlength="40" value="${p.numero || ""}" placeholder="0000000-00.0000.0.00.0000"></label>
      ${d("data_distribuicao", "Data de distribuição")}
      ${s("instancia", "Instância", apoio.instancias)}
      ${s("fase", "Fase processual", apoio.fases)}
      <label>Valor da ação (R$)<input name="valor_causa" inputmode="decimal" value="${p.valor_causa ?? ""}" placeholder="0,00"></label>
      ${t("numero_vara", "Nº vara", { placeholder: "1ª" })}
      ${t("vara", "Órgão julgador", { list: "l-orgao" })}
      ${t("comarca", "Comarca", { list: "l-comarca" })}
      <label>UF<select name="uf">${opcoes(UFS, p.uf)}</select></label>
      ${s("competencia", "Competência", apoio.competencias)}
      ${s("rito", "Rito processual", apoio.ritos)}
      ${d("data_citacao", "Data de citação")}
      ${d("data_transito", "Trânsito em julgado")}
      ${d("data_encerramento", "Data do encerramento")}
      ${s("motivo_encerramento", "Motivo do encerramento", apoio.motivos)}`)}
    ${grupo("Outras Informações", html`
      <label class="duplo">Advogado da parte contrária<input name="advogado_parte_contraria" maxlength="200" value="${p.advogado_parte_contraria || ""}"></label>
      ${t("oab_parte_contraria", "Número OAB", { placeholder: "RS000000" })}
      <label>Telefone<input name="telefone" maxlength="40" inputmode="tel" value="${p.telefone || ""}"></label>
      <label class="duplo">E-mail<input name="email" type="email" maxlength="200" value="${p.email || ""}"></label>
      ${p.contato ? html`<label class="largo">Contato (registro antigo)<input name="contato" maxlength="400" value="${p.contato}"></label>` : ""}`)}
    ${grupo("Decisões", html`
      ${s("resultado_primeira", "Decisão 1ª instância", apoio.resultados)}${d("data_decisao_primeira", "Data da decisão")}
      ${s("resultado_segunda", "Decisão 2ª instância", apoio.resultados)}${d("data_decisao_segunda", "Data da decisão")}
      ${s("resultado_superior", "Instâncias superiores", apoio.resultados)}${d("data_decisao_superior", "Data da decisão")}
      ${s("resultado_atual", "Resultado atual", apoio.resultados)}${d("data_decisao_final", "Data da decisão")}`, "grupo-decisoes")}
    <label class="largo">Observações<textarea name="observacoes" rows="4" maxlength="4000" placeholder="Ex.: Honorários de êxito: 10%">${p.observacoes || ""}</textarea></label>
    <div class="largo botoes-form"><button type="submit">Salvar</button><a class="botao-link botao-secundario" href="${p.id ? `/sistema/processos/${p.id}` : "/sistema/processos"}">Cancelar</a></div>
    ${datalist("l-acao", apoio.acoes)}${datalist("l-advogado", apoio.advogados)}${datalist("l-orgao", apoio.orgaos)}${datalist("l-comarca", apoio.comarcas)}
  </form>
  <p class="dica">Telefone, e-mail da parte contrária e observações são gravados cifrados.</p>`;
}

export async function cadastroProcesso(req, env, sessao, id) {
  const existente = id ? await env.DB.prepare("SELECT * FROM processos WHERE id = ?").bind(Number(id)).first() : null;
  if (id && !existente) return naoEncontrado(sessao);
  const acao = id ? `/sistema/processos/${id}/editar` : "/sistema/processos/novo";
  const [clientes, acoes, ritos, fases, instancias, situacoes, competencias, posicoes, advogados, resultados, orgaos, comarcas, motivos] = await Promise.all([
    env.DB.prepare("SELECT id, nome FROM clientes ORDER BY nome COLLATE NOCASE").all(),
    ...["tipo_acao", "rito", "fase", "instancia", "situacao", "competencia", "posicao_cliente", "advogado_responsavel", "resultado_atual", "vara", "comarca", "motivo_encerramento"]
      .map((c) => usados(env, "processos", c)),
  ]);
  const juntar = (...l) => [...new Set(l.flat().filter(Boolean))];
  const apoio = {
    clientes: clientes.results.map((c) => [c.id, c.nome]), acoes, advogados: juntar("Eduardo Donini", advogados), orgaos, comarcas,
    ritos: juntar("Ordinário", "Sumaríssimo", "Especial", ritos), instancias: juntar("1º Grau", "2º Grau", "Instâncias Superiores", instancias),
    competencias: juntar("Estadual", "Federal", "Trabalhista", "Juizado Especial Cível", "Juizado Especial Federal", competencias),
    fases: juntar(FASES, fases), situacoes: juntar("Ativa", "Suspensa", "Encerrada", situacoes),
    posicoes: juntar("Autor", "Réu", "Reclamante", "Reclamado", "Exequente", "Executado", "Requerente", "Requerido", posicoes),
    resultados: juntar(RESULTADOS, resultados), motivos: juntar(MOTIVOS, motivos),
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
      return tela({ cliente_id: cli, pasta: String((proxima?.n || 0) + 1).padStart(4, "0"), situacao: "Ativa", data_cadastro: new Date().toISOString().slice(0, 10), uf: "RS" });
    }
    const [contato, observacoes, telefone, email] = await Promise.all([existente.contato_parte_contraria_enc, existente.observacoes_enc,
      existente.telefone_parte_contraria_enc, existente.email_parte_contraria_enc].map((v) => decifrar(env, v)));
    return tela({ ...existente, contato, observacoes, telefone, email });
  }
  const { f, ok } = await csrfOk(req, sessao);
  const p = { id: existente?.id, cliente_id: Number(f.get("cliente_id")) || null, contato: txt(f, "contato", 400), observacoes: txt(f, "observacoes", 4000),
    telefone: txt(f, "telefone", 40), email: txt(f, "email", 200) };
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
  const [contatoEnc, obsEnc, telEnc, emailEnc] = await Promise.all([p.contato, p.observacoes, p.telefone, p.email].map((v) => cifrar(env, v)));
  const t = agora();
  let novoId = existente?.id;
  if (existente) {
    await env.DB.prepare(`UPDATE processos SET ${colunas.map((c) => `${c} = ?`).join(", ")}, contato_parte_contraria_enc = ?, observacoes_enc = ?,
      telefone_parte_contraria_enc = ?, email_parte_contraria_enc = ?, atualizado_em = ?, editado_local = 1 WHERE id = ?`).bind(...valores, contatoEnc, obsEnc, telEnc, emailEnc, t, existente.id).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO processos (${colunas.join(", ")}, contato_parte_contraria_enc, observacoes_enc, telefone_parte_contraria_enc, email_parte_contraria_enc, criado_em, atualizado_em, editado_local)
      VALUES (${colunas.map(() => "?").join(", ")}, ?, ?, ?, ?, ?, ?, 1)`).bind(...valores, contatoEnc, obsEnc, telEnc, emailEnc, t, t).run();
    novoId = r.meta.last_row_id;
  }
  await auditar(env, req, sessao.usuario_id, existente ? "processo_alterado" : "processo_criado", `processo ${novoId}`);
  return redirecionar(`/sistema/processos/${novoId}?salvo=1`);
}
