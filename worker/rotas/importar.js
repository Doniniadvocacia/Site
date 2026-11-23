// Importação de Clientes e Processos do Wix (somente administradores).
// Os dados vão direto da API do Wix para o D1, cifrando os campos sensíveis no caminho.
import { html, pagina, resposta, campoCsrf } from "../html.js";
import { agora, cifrar, iguais } from "../seguranca.js";
import { auditar } from "../sessao.js";

const SITE_ID_PADRAO = "4ce0a7a8-3fa0-495f-a643-664a08144c36";

async function lerColecao(env, colecao) {
  const itens = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch("https://www.wixapis.com/wix-data/v2/items/query", {
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
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.$date) return String(v.$date).slice(0, 10);
  if (typeof v === "object") return v._id || null;
  return String(v).trim() || null;
};
const juntar = (...partes) => partes.map(txt).filter(Boolean).join(", ") || null;

export async function importar(req, env, sessao) {
  const tela = (opts = {}) => resposta(pagina({
    titulo: "Importar do Wix", sessao, ...opts,
    corpo: html`
      <h1>Importar do Wix</h1>
      <section class="cartao">
        <p>Copia os clientes e processos do sistema atual no Wix para o banco novo. Registros já importados são atualizados, sem duplicar.</p>
        <p class="dica">Documentos, contatos, endereços e observações são gravados cifrados. Pode ser repetido quantas vezes for preciso até a virada.</p>
        ${env.WIX_API_KEY ? html`<form method="post">${campoCsrf(sessao)}<button type="submit">Importar agora</button></form>`
          : html`<p class="erro">O segredo WIX_API_KEY não está configurado no Cloudflare.</p>`}
      </section>`,
  }));
  if (req.method === "GET") return tela();
  const f = await req.formData();
  if (!iguais(String(f.get("csrf") || ""), sessao.csrf)) return tela({ erro: "Sessão expirada. Tente novamente." });

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
           data_cadastro=?16, atualizado_em=?17`
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
           data_decisao_superior=?30, data_decisao_final=?31, proximo_prazo=?32, contato_parte_contraria_enc=?33, observacoes_enc=?34, atualizado_em=?35`
      ).bind(p._id, idCliente[ref] ?? null, txt(p.pasta), txt(p.numero), txt(p.title), txt(p.tipoAcao), txt(p.rito), txt(p.fase), txt(p.instancia),
        txt(p.situacao), txt(p.competencia), txt(p.comarca), txt(p.vara) || txt(p.nmeroVara), txt(p.uf), txt(p.posicaoCliente), txt(p.parteContraria),
        txt(p.advogadoParteContraria), txt(p.advogadoResponsavel), txt(p.ajgDeferida),
        p.valorCausa === null || p.valorCausa === undefined || p.valorCausa === "" ? null : Number(p.valorCausa),
        txt(p.dataDistribuicao), txt(p.dataCadastro), txt(p.resultado), txt(p.resultadoAtual), txt(p.resultadoPrimeiraInstancia),
        txt(p.dataDecisaoPrimeira), txt(p.resultadoSegundaInstancia), txt(p.dataDecisaoSegunda), txt(p.resultadoSuperiorInstancia),
        txt(p.dataDecisaoSuperior), txt(p.dataDecisaoFinal), txt(p.proximoPrazo),
        await cifrar(env, juntar(p.emailParteContraria, p.telefoneParteContraria)), await cifrar(env, txt(p.observacoes)), t));
    }
    for (let i = 0; i < ps.length; i += 50) await env.DB.batch(ps.slice(i, i + 50));
    const semCliente = processos.filter((p) => !idCliente[typeof p.cliente === "object" && p.cliente ? p.cliente._id : p.cliente]).length;
    const resumo = `${clientes.length} clientes e ${processos.length} processos importados${semCliente ? ` (${semCliente} processo(s) sem cliente vinculado)` : ""}.`;
    await auditar(env, req, sessao.usuario_id, "importacao_wix", resumo);
    return tela({ aviso: resumo });
  } catch (e) {
    await auditar(env, req, sessao.usuario_id, "importacao_wix_erro", e.message);
    return tela({ erro: `A importação falhou: ${e.message}` });
  }
}
