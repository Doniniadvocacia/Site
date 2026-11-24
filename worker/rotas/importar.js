// Importação dos dados do Wix (somente administradores): cadastros, prazos, intimações, agenda, histórico e financeiro.
// Os dados vão direto da API do Wix para o D1, cifrando os campos sensíveis no caminho.
import { html, pagina, resposta, campoCsrf } from "../html.js";
import { agora, cifrar, iguais } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { normalizarData, hojeBR } from "../calendario.js";
import { copiarAnexosWix, anexosDisponiveis, nomeSeguro } from "../anexos.js";

const SITE_ID_PADRAO = "4ce0a7a8-3fa0-495f-a643-664a08144c36";

async function lerColecao(env, colecao) {
  const itens = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${env.WIX_API_BASE || "https://www.wixapis.com"}/wix-data/v2/items/query`, {
      method: "POST",
      headers: { Authorization: env.WIX_API_KEY, "wix-site-id": env.WIX_SITE_ID || SITE_ID_PADRAO, "Content-Type": "application/json" },
      body: JSON.stringify({ dataCollectionId: colecao, query: { paging: { limit: 1000, offset } } }),
    });
    if (!r.ok) throw new Error(`Wix respondeu ${r.status} ao ler ${colecao}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const lote = (j.dataItems || []).map((d) => d.data);
    itens.push(...lote);
    if (lote.length < 1000) return itens;
  }
}

// Datas do Wix podem vir como texto ou como {"$date": "..."}.
const txt = (v) => {
  if (v === null || v === undefined || v === "RESET_ALL") return null;
  if (typeof v === "object" && v.$date) return String(v.$date).slice(0, 10);
  if (typeof v === "object") return v._id || null;
  return String(v).trim() || null;
};
const juntar = (...partes) => partes.map(txt).filter(Boolean).join(", ") || null;

export async function importar(req, env, sessao) {
  const contar = async () => {
    const r = await env.DB.prepare(`SELECT SUM(chave IS NOT NULL) AS copiados, SUM(chave IS NULL AND origem_wix IS NOT NULL) AS pendentes,
      SUM(chave IS NULL AND erro IS NOT NULL) AS falhas FROM anexos`).first();
    return { copiados: r?.copiados || 0, pendentes: r?.pendentes || 0, falhas: r?.falhas || 0 };
  };
  let anexos = await contar();
  const tela = async (opts = {}) => { anexos = await contar(); return telaBase(opts); };
  const telaBase = (opts = {}) => resposta(pagina({
    titulo: "Importar do Wix", sessao, ...opts,
    corpo: html`
      <h1>Importar do Wix</h1>
      <section class="cartao">
        <p>Copia clientes e processos (atualizando os já importados) e traz prazos, intimações, compromissos, histórico e lançamentos financeiros que ainda não existem aqui. Registros criados ou editados neste sistema não são sobrescritos.</p>
        <p class="dica">Documentos, contatos, endereços, dados bancários e observações são gravados cifrados. Pode ser repetido quantas vezes for preciso até a virada.</p>
        ${env.WIX_API_KEY ? html`<form method="post">${campoCsrf(sessao)}<button type="submit" name="acao" value="importar">Importar agora</button></form>`
          : html`<p class="erro">O segredo WIX_API_KEY não está configurado no Cloudflare.</p>`}
      </section>
      <section class="cartao"><h2>Anexos do Wix</h2>
        <p>${String(anexos.copiados)} copiado(s) · ${String(anexos.pendentes)} pendente(s)${anexos.falhas ? ` · ${anexos.falhas} com erro na última tentativa` : ""}.</p>
        ${!anexosDisponiveis(env) ? html`<p class="erro">O R2 ainda não está ativado no Cloudflare; os anexos ficam registrados e serão copiados depois.</p>`
          : anexos.pendentes ? html`<form method="post">${campoCsrf(sessao)}<button type="submit" name="acao" value="anexos">Copiar próximos anexos</button></form>
            <p class="dica">Copia alguns arquivos por vez, já cifrados. Clique de novo até zerar os pendentes.</p>` : ""}
      </section>`,
  }));
  if (req.method === "GET") return tela();
  const f = await req.formData();
  if (!iguais(String(f.get("csrf") || ""), sessao.csrf)) return tela({ erro: "Sessão expirada. Tente novamente." });
  if (f.get("acao") === "anexos") {
    try {
      const r = await copiarAnexosWix(env, 8);
      await auditar(env, req, sessao.usuario_id, "anexos_wix", `${r.ok} copiados, ${r.falhas} falhas`);
      return tela({ aviso: `${r.ok} anexo(s) copiado(s)${r.falhas ? `, ${r.falhas} com erro` : ""}. Restam ${r.pendentes}.` });
    } catch (e) { return tela({ erro: `Falha ao copiar anexos: ${e.message}` }); }
  }

  try {
    const t = agora();
    const clientes = await lerColecao(env, "Clientes");
    const stmts = [];
    for (const c of clientes) {
      stmts.push(env.DB.prepare(
        `INSERT INTO clientes (wix_id, nome, tipo, posicao, genero, estado_civil, profissao, cidade, estado,
           documento_enc, data_nascimento_enc, email_enc, telefone_enc, endereco_enc, observacoes_enc, data_cadastro, criado_em, atualizado_em)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)
         ON CONFLICT(wix_id) DO UPDATE SET nome=?2, tipo=?3, posicao=?4, genero=?5, estado_civil=?6, profissao=?7, cidade=?8, estado=?9,
           documento_enc=?10, data_nascimento_enc=?11, email_enc=?12, telefone_enc=?13, endereco_enc=?14, observacoes_enc=?15,
           data_cadastro=?16, atualizado_em=?17 WHERE clientes.editado_local = 0`
      ).bind(c._id, txt(c.nome) || txt(c.title) || "(sem nome)", txt(c.tipo), txt(c.posicao), txt(c.genero), txt(c.estadoCivil),
        txt(c.profissao), txt(c.cidade), txt(c.estado),
        await cifrar(env, txt(c.documento)), await cifrar(env, txt(c.dataNascimento)), await cifrar(env, txt(c.email)),
        await cifrar(env, txt(c.telefone)), await cifrar(env, juntar(c.endereco, c.bairro, c.cep)), await cifrar(env, txt(c.observacoes)),
        txt(c.dataCadastro), t));
    }
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

    const { results: mapa } = await env.DB.prepare("SELECT id, wix_id FROM clientes WHERE wix_id IS NOT NULL").all();
    const idCliente = Object.fromEntries(mapa.map((m) => [m.wix_id, m.id]));
    const processos = await lerColecao(env, "Processos");
    const ps = [];
    for (const p of processos) {
      const ref = typeof p.cliente === "object" && p.cliente ? p.cliente._id : p.cliente;
      ps.push(env.DB.prepare(
        `INSERT INTO processos (wix_id, cliente_id, pasta, numero, titulo, tipo_acao, rito, fase, instancia, situacao, competencia, comarca, vara, uf,
           posicao_cliente, parte_contraria, advogado_parte_contraria, advogado_responsavel, ajg_deferida, valor_causa, data_distribuicao, data_cadastro,
           resultado, resultado_atual, resultado_primeira, data_decisao_primeira, resultado_segunda, data_decisao_segunda, resultado_superior,
           data_decisao_superior, data_decisao_final, proximo_prazo, contato_parte_contraria_enc, observacoes_enc, criado_em, atualizado_em)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?35)
         ON CONFLICT(wix_id) DO UPDATE SET cliente_id=?2, pasta=?3, numero=?4, titulo=?5, tipo_acao=?6, rito=?7, fase=?8, instancia=?9, situacao=?10,
           competencia=?11, comarca=?12, vara=?13, uf=?14, posicao_cliente=?15, parte_contraria=?16, advogado_parte_contraria=?17,
           advogado_responsavel=?18, ajg_deferida=?19, valor_causa=?20, data_distribuicao=?21, data_cadastro=?22, resultado=?23, resultado_atual=?24,
           resultado_primeira=?25, data_decisao_primeira=?26, resultado_segunda=?27, data_decisao_segunda=?28, resultado_superior=?29,
           data_decisao_superior=?30, data_decisao_final=?31, proximo_prazo=?32, contato_parte_contraria_enc=?33, observacoes_enc=?34, atualizado_em=?35
         WHERE processos.editado_local = 0`
      ).bind(p._id, idCliente[ref] ?? null, txt(p.pasta), txt(p.numero), txt(p.title), txt(p.tipoAcao), txt(p.rito), txt(p.fase), txt(p.instancia),
        txt(p.situacao), txt(p.competencia), txt(p.comarca), txt(p.vara), txt(p.uf), txt(p.posicaoCliente), txt(p.parteContraria),
        txt(p.advogadoParteContraria), txt(p.advogadoResponsavel), txt(p.ajgDeferida),
        p.valorCausa === null || p.valorCausa === undefined || p.valorCausa === "" ? null : Number(p.valorCausa),
        txt(p.dataDistribuicao), txt(p.dataCadastro), txt(p.resultado), txt(p.resultadoAtual), txt(p.resultadoPrimeiraInstancia),
        txt(p.dataDecisaoPrimeira), txt(p.resultadoSegundaInstancia), txt(p.dataDecisaoSegunda), txt(p.resultadoSuperiorInstancia),
        txt(p.dataDecisaoSuperior), txt(p.dataDecisaoFinal), txt(p.proximoPrazo),
        await cifrar(env, juntar(p.emailParteContraria, p.telefoneParteContraria)), await cifrar(env, txt(p.observacoes)), t));
    }
    for (let i = 0; i < ps.length; i += 50) await env.DB.batch(ps.slice(i, i + 50));
    // Campos complementares da ficha (vara, citação, trânsito, encerramento, contatos da parte contrária).
    const ps2 = [];
    for (const p of processos) {
      ps2.push(env.DB.prepare(`UPDATE processos SET numero_vara=?, data_citacao=?, data_transito=?, data_encerramento=?, motivo_encerramento=?,
          oab_parte_contraria=?, telefone_parte_contraria_enc=?, email_parte_contraria_enc=? WHERE wix_id=? AND editado_local=0`)
        .bind(txt(p.nmeroVara), normalizarData(p.dataCitacao), normalizarData(p.dataTransito), normalizarData(p.dataEncerramento),
          txt(p.motivoEncerramento), txt(p.numeroOAB), await cifrar(env, txt(p.telefoneParteContraria)), await cifrar(env, txt(p.emailParteContraria)), p._id));
    }
    for (let i = 0; i < ps2.length; i += 50) await env.DB.batch(ps2.slice(i, i + 50));
    const semCliente = processos.filter((p) => !idCliente[typeof p.cliente === "object" && p.cliente ? p.cliente._id : p.cliente]).length;

    // Prazos, intimações e agenda: só entram os que ainda não existem (edições feitas aqui são preservadas).
    const { results: mapaP } = await env.DB.prepare("SELECT id, wix_id, numero, pasta FROM processos").all();
    const dig = (v) => String(v || "").replace(/\D/g, "");
    const porWix = new Map(mapaP.filter((x) => x.wix_id).map((x) => [x.wix_id, x.id]));
    const porNumero = new Map(mapaP.filter((x) => x.numero).map((x) => [dig(x.numero), x.id]));
    const porPasta = new Map(mapaP.filter((x) => x.pasta).map((x) => [String(x.pasta).trim(), x.id]));
    const acharProcesso = (ref, pasta) => (ref && (porWix.get(ref) ?? porNumero.get(dig(ref)))) || (pasta && porPasta.get(String(pasta).trim())) || null;
    const novos = { prazos: 0, publicacoes: 0, agenda: 0 };

    const prazos = await lerColecao(env, "Prazos");
    const sp = prazos.map((z) => {
      const marca = `${txt(z.status) || ""} ${txt(z.situacaoCumprido) || ""}`.toLowerCase();
      const situacao = /cancel/.test(marca) ? "cancelado" : (/cumprid|sim|conclu/.test(marca) || z.dataCumprimento) ? "cumprido" : "aberto";
      return env.DB.prepare(`INSERT INTO prazos (wix_id, processo_id, titulo, tipo, categoria, descricao, prazo_fatal, prazo_interno, hora, responsavel,
          situacao, data_cumprimento, data_audiencia, hora_audiencia, uf, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wix_id) DO NOTHING`)
        .bind(z._id, acharProcesso(txt(z.processoId), txt(z.pasta)), txt(z.title) || txt(z.tipo) || "Prazo", txt(z.tipo), txt(z.categoria) === "Compromisso" ? "Compromisso" : "Prazo", txt(z.descricao),
          normalizarData(z.prazoFatal), normalizarData(z.prazoInterno), txt(z.hora), txt(z.responsavel), situacao,
          normalizarData(z.dataCumprimento), normalizarData(z.dataAudiencia), txt(z.horaAudiencia), txt(z.uf), t, t);
    });
    for (let i = 0; i < sp.length; i += 50) for (const r of await env.DB.batch(sp.slice(i, i + 50))) novos.prazos += r.meta.changes;

    const pubs = await lerColecao(env, "Publicacoes");
    const spub = pubs.map((u) => {
      const d = normalizarData(u.dataPublicao);
      return env.DB.prepare(`INSERT INTO publicacoes (wix_id, djen_id, data_disponibilizacao, data_publicacao, tribunal, tipo, numero_processo, processo_id,
          texto, link, oab, situacao, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'importada', ?) ON CONFLICT DO NOTHING`)
        .bind(u._id, txt(u.idDJEN), d, d, txt(u.tribunal), txt(u.tipo), txt(u.processo), acharProcesso(txt(u.processo)), txt(u.text) || txt(u.title),
          txt(u.link), txt(u.oab), t);
    });
    for (let i = 0; i < spub.length; i += 50) for (const r of await env.DB.batch(spub.slice(i, i + 50))) novos.publicacoes += r.meta.changes;

    const ags = await lerColecao(env, "Agenda");
    const sag = ags.filter((a) => normalizarData(a.dataHora)).map((a) => {
      const iso = typeof a.dataHora === "object" && a.dataHora?.$date ? a.dataHora.$date : String(a.dataHora);
      const hora = (iso.match(/T(\d{2}:\d{2})/) || [])[1] || null;
      const proc = typeof a.processo === "object" && a.processo ? a.processo._id : a.processo;
      const cli = typeof a.cliente === "object" && a.cliente ? a.cliente._id : a.cliente;
      return env.DB.prepare(`INSERT INTO agenda (wix_id, processo_id, cliente_id, titulo, tipo, data, hora, local, observacoes, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wix_id) DO NOTHING`)
        .bind(a._id, porWix.get(proc) ?? null, idCliente[cli] ?? null, txt(a.title) || "Compromisso", txt(a.tipo), normalizarData(a.dataHora), hora,
          txt(a.local), txt(a.observacoes), t, t);
    });
    for (let i = 0; i < sag.length; i += 50) for (const r of await env.DB.batch(sag.slice(i, i + 50))) novos.agenda += r.meta.changes;

    // Histórico e financeiro: só entram os que ainda não existem. Anexos ficam registrados para cópia posterior.
    const hist = await lerColecao(env, "Historico");
    const fin = await lerColecao(env, "Financeiro");
    const regAnexos = [];
    for (const [lista, campo, nomeCampo, ctx] of [[hist, "arquivoUrl", "arquivoNome", "historico"], [fin, "arquivo", "arquivoNome", "financeiro"]]) {
      for (const x of lista) {
        const origem = txt(x[campo]);
        if (origem && origem.startsWith("wix:document://")) {
          regAnexos.push(env.DB.prepare("INSERT INTO anexos (nome, contexto, origem_wix, criado_em) VALUES (?, ?, ?, ?) ON CONFLICT(origem_wix) DO NOTHING")
            .bind(nomeSeguro(txt(x[nomeCampo]) || origem.split("/").pop()), ctx, origem, t));
        }
      }
    }
    for (let i = 0; i < regAnexos.length; i += 50) await env.DB.batch(regAnexos.slice(i, i + 50));
    const { results: mapaA } = await env.DB.prepare("SELECT id, origem_wix FROM anexos WHERE origem_wix IS NOT NULL").all();
    const idAnexo = new Map(mapaA.map((a) => [a.origem_wix, a.id]));
    const norm = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const { results: nomesCli } = await env.DB.prepare("SELECT id, nome FROM clientes").all();
    const porNome = new Map(nomesCli.map((c) => [norm(c.nome), c.id]));
    const { results: cliDoProc } = await env.DB.prepare("SELECT id, cliente_id FROM processos").all();
    const clienteDoProcesso = new Map(cliDoProc.map((x) => [x.id, x.cliente_id]));
    novos.historico = 0; novos.financeiro = 0;
    let semData = 0;

    const sh = hist.filter((x) => txt(x.descricao)).map((x) => {
      const pid = acharProcesso(txt(x.numeroProcesso), txt(x.pasta));
      return env.DB.prepare(`INSERT INTO historico (wix_id, processo_id, cliente_id, data, descricao, anexo_id, criado_em)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(wix_id) DO NOTHING`)
        .bind(x._id, pid, porNome.get(norm(txt(x.cliente))) ?? clienteDoProcesso.get(pid) ?? null,
          normalizarData(x.dataCadastro) || normalizarData(x._createdDate) || hojeBR(), txt(x.descricao), idAnexo.get(txt(x.arquivoUrl)) ?? null, t);
    });
    for (let i = 0; i < sh.length; i += 50) for (const r of await env.DB.batch(sh.slice(i, i + 50))) novos.historico += r.meta.changes;

    const sf = [];
    for (const x of fin) {
      const venc = normalizarData(x.vencimento) || normalizarData(x.data) || normalizarData(x.dataPagamento);
      const valor = Number(x.valor);
      if (!venc || !Number.isFinite(valor)) { semData++; continue; }
      const pid = acharProcesso(txt(x.numeroProcesso), txt(x.pasta));
      const banco = [["Banco", x.banco], ["Agência", x.agencia], ["Conta", x.conta], ["Pix", x.chavePix], ["Conta de origem", x.contaOrigem]]
        .filter(([, v]) => txt(v)).map(([k, v]) => `${k}: ${txt(v)}`).join("\n");
      const parcelas = Number(txt(x.numeroParcelas)) || Number(txt(x.tipoRecorrencia)) || null;
      sf.push(env.DB.prepare(`INSERT INTO financeiro (wix_id, tipo, categoria, descricao, processo_id, cliente_id, valor, vencimento, pago, data_pagamento,
          forma_pagamento, condicao, grupo, parcela, parcelas, responsavel, pagante, favorecido, dados_bancarios_enc, observacoes_enc, anexo_id, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wix_id) DO NOTHING`)
        .bind(x._id, /desp/i.test(txt(x.tipo) || "") ? "despesa" : "receita", txt(x.categoria) || txt(x.origem),
          txt(x.descricao) || txt(x.title) || txt(x.categoria) || "Lançamento", pid, porNome.get(norm(txt(x.cliente))) ?? clienteDoProcesso.get(pid) ?? null,
          valor, venc, x.pago ? 1 : 0, x.pago ? normalizarData(x.dataPagamento) : null, txt(x.formaPagamento), txt(x.condicaoPagamento),
          txt(x.grupoId), Number.isFinite(Number(x.numeroParcela)) && x.numeroParcela !== null ? Number(x.numeroParcela) : null, parcelas,
          txt(x.advogadoResponsavel), txt(x.pagante), txt(x.favorecido), await cifrar(env, banco || null), await cifrar(env, txt(x.observacoes)),
          idAnexo.get(txt(x.arquivo)) ?? null, t, t));
    }
    for (let i = 0; i < sf.length; i += 50) for (const r of await env.DB.batch(sf.slice(i, i + 50))) novos.financeiro += r.meta.changes;

    const resumo = `${clientes.length} clientes e ${processos.length} processos atualizados${semCliente ? ` (${semCliente} processo(s) sem cliente vinculado)` : ""}. ` +
      `Novos: ${novos.prazos} de ${prazos.length} prazos, ${novos.publicacoes} de ${pubs.length} intimações, ${novos.agenda} de ${ags.length} compromissos, ` +
      `${novos.historico} de ${hist.length} andamentos, ${novos.financeiro} de ${fin.length} lançamentos financeiros${semData ? ` (${semData} sem data ou valor, ignorados)` : ""}.`;
    await auditar(env, req, sessao.usuario_id, "importacao_wix", resumo);
    return tela({ aviso: resumo });
  } catch (e) {
    await auditar(env, req, sessao.usuario_id, "importacao_wix_erro", e.message);
    return tela({ erro: `A importação falhou: ${e.message}` });
  }
}
