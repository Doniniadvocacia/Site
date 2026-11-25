// Telas da integração com o Asaas: Configurações › Asaas, conciliação do extrato e emissão/cancelamento de cobranças.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR, moeda } from "../html.js";
import { agora } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt, opcoes } from "./comum.js";
import { categoriasFinanceiras } from "../listas.js";
import {
  asaasConfigurado, saldoAsaas, ativarAvisos, sincronizar, lerConfig, gerarCobranca, cancelarCobranca, FORMAS, STATUS, CONTA_ASAAS,
} from "../asaas.js";

const quando = (s) => (s ? new Date((Number(s) - 3 * 3600) * 1000).toISOString().slice(0, 16).replace("T", " ").split(" ").map((x, i) => (i ? x : x.split("-").reverse().join("/"))).join(" às ") : "nunca");
const TIPOS_EXTRATO = {
  PAYMENT_RECEIVED: "Recebimento de cobrança", PAYMENT_FEE: "Taxa de cobrança", TRANSFER: "Transferência", TRANSFER_FEE: "Taxa de transferência",
  BILL_PAYMENT: "Pagamento de conta", BILL_PAYMENT_FEE: "Taxa de pagamento de conta", PIX_TRANSACTION_DEBIT: "Pix enviado", PIX_TRANSACTION_CREDIT: "Pix recebido",
  PAYMENT_REVERSAL: "Estorno de cobrança", PAYMENT_REFUND_CANCELLED: "Estorno cancelado", INTERNAL_TRANSFER_CREDIT: "Transferência recebida",
  INTERNAL_TRANSFER_DEBIT: "Transferência enviada", RECEIVABLE_ANTICIPATION_GROSS_CREDIT: "Antecipação", RECEIVABLE_ANTICIPATION_FEE: "Taxa de antecipação",
  PAYMENT_MESSAGING_NOTIFICATION_FEE: "Taxa de notificação", PAYMENT_SMS_NOTIFICATION_FEE: "Taxa de SMS", PAYMENT_DUNNING_REQUEST_FEE: "Taxa de negativação",
};
const rotuloTipo = (t) => TIPOS_EXTRATO[t] || (t ? t.toLowerCase().replace(/_/g, " ") : "Movimentação");

// ---------- Configurações › Asaas (administradores) ----------
export async function configAsaas(req, env, sessao) {
  const url = new URL(req.url);
  const volta = (msg) => redirecionar(`/sistema/asaas?msg=${msg}`);
  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return volta("sessao");
    try {
      if (f.get("acao") === "avisos") {
        await ativarAvisos(env, `${url.origin}/sistema/asaas/aviso`, sessao.email, sessao.usuario_id);
        await auditar(env, req, sessao.usuario_id, "asaas_avisos_ativados", url.origin);
        return volta("avisos");
      }
      if (f.get("acao") === "sincronizar") {
        const r = await sincronizar(env);
        await auditar(env, req, sessao.usuario_id, "asaas_sincronizado", JSON.stringify(r));
        return redirecionar(`/sistema/asaas?msg=sync&b=${r.baixados || 0}&e=${r.extrato || 0}`);
      }
    } catch (e) {
      return resposta(pagina({ titulo: "Asaas", sessao, erro: e.message, corpo: html`<p class="trilha"><a href="/sistema/asaas">Voltar</a></p>` }), 502);
    }
    return volta("sessao");
  }
  const configurado = asaasConfigurado(env);
  const [saldo, webhookUrl, ultima, { results: eventos }, pend] = await Promise.all([
    configurado ? saldoAsaas(env, { forcar: true }) : null, lerConfig(env, "asaas_webhook_url"), lerConfig(env, "asaas_ultima_sync"),
    env.DB.prepare("SELECT tipo, cobranca_id, resultado, recebido_em, financeiro_id FROM asaas_eventos ORDER BY recebido_em DESC LIMIT 10").all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM asaas_extrato WHERE situacao = 'pendente'").first(),
  ]);
  const msg = url.searchParams.get("msg");
  const avisoTxt = msg === "avisos" ? "Avisos automáticos ativados: pagamentos no Asaas passam a baixar os lançamentos sozinhos."
    : msg === "sync" ? `Sincronização concluída: ${url.searchParams.get("b") || 0} lançamento(s) baixado(s), ${url.searchParams.get("e") || 0} movimentação(ões) nova(s) no extrato.` : null;
  const urlAtual = `${url.origin}/sistema/asaas/aviso`;
  return resposta(pagina({
    titulo: "Asaas", sessao, ...(avisoTxt ? { aviso: avisoTxt } : {}), ...(msg === "sessao" ? { erro: "Sessão expirada. Tente novamente." } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/configuracoes">Configurações</a></p>
      <h1>Integração com o Asaas</h1>
      ${!configurado ? html`<section class="cartao"><h2>Chave não configurada</h2>
        <p>Para ativar, gere uma chave de API no Asaas (Integrações › Chaves de API) e cadastre-a como segredo <strong>ASAAS_API_KEY</strong> nas variáveis e segredos da build do Cloudflare. Depois, publique de novo.</p>
        <p class="dica">Deixe desligada a "lista de IPs autorizados" da chave: os servidores da Cloudflare não têm IP fixo.</p></section>`
        : html`
      <div class="resumo-financeiro">
        <div class="cartao-resumo"><span>Conexão</span><strong class="${saldo?.erro ? "despesa" : "receita"}">${saldo?.erro ? "Com erro" : "Conectado"}</strong>${saldo?.erro ? html`<small>${saldo.erro}</small>` : ""}</div>
        <div class="cartao-resumo"><span>Saldo no Asaas</span><strong>${saldo?.erro ? "—" : moeda(saldo?.saldo)}</strong></div>
        <div class="cartao-resumo"><span>Extrato a conciliar</span><strong>${String(pend?.n || 0)}</strong><small><a href="/sistema/financeiro/conciliacao">abrir conciliação</a></small></div>
      </div>
      <section class="cartao"><h2>Avisos automáticos (baixa de pagamentos)</h2>
        ${webhookUrl ? html`<p>Ativos. O Asaas avisa este endereço a cada pagamento, vencimento, estorno ou cancelamento: <code>${webhookUrl}</code></p>
          ${webhookUrl !== urlAtual ? html`<p class="alerta-dominio">O sistema está sendo acessado por outro endereço (<code>${url.origin}</code>). Depois de mudar o domínio, clique em "Atualizar endereço dos avisos".</p>` : ""}`
          : html`<p>Desativados. Ative para que os pagamentos feitos no Asaas baixem os lançamentos do Diligo na hora.</p>`}
        <form method="post" class="form-linha">${campoCsrf(sessao)}<button type="submit" name="acao" value="avisos">${webhookUrl ? "Atualizar endereço dos avisos" : "Ativar avisos automáticos"}</button></form>
      </section>
      <section class="cartao"><h2>Sincronização</h2>
        <p>Confere as cobranças em aberto, traz os recebimentos e o extrato dos últimos 45 dias. Roda sozinha nos dias úteis; use o botão para atualizar agora.</p>
        <p class="dica">Última sincronização: ${quando(ultima)}.</p>
        <form method="post" class="form-linha">${campoCsrf(sessao)}<button type="submit" name="acao" value="sincronizar" class="botao-secundario">Sincronizar agora</button></form>
      </section>
      <section class="cartao"><h2>Últimos avisos recebidos</h2>
        ${eventos.length ? html`<div class="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Evento</th><th>Cobrança</th><th>Resultado</th></tr></thead>
          <tbody>${eventos.map((e) => html`<tr><td>${quando(e.recebido_em)}</td><td>${e.tipo}</td><td>${e.cobranca_id || "—"}</td>
            <td>${e.financeiro_id ? html`<a href="/sistema/financeiro/${String(e.financeiro_id)}">${e.resultado}</a>` : e.resultado || "—"}</td></tr>`)}</tbody></table></div>`
          : html`<p class="vazio">Nenhum aviso recebido ainda.</p>`}
      </section>`}`,
  }));
}

// ---------- Emissão e cancelamento de cobranças ----------
export async function cobrancaLancamento(req, env, sessao, id, acao) {
  const lid = Number(id);
  const volta = (msg, extra = "") => redirecionar(`/sistema/financeiro/${lid}?asaas=${msg}${extra}#cobranca`);
  const { f, ok } = await csrfOk(req, sessao);
  if (!ok) return volta("sessao");
  const l = await env.DB.prepare(`SELECT f.*, pr.cliente_id AS cliente_processo_id FROM financeiro f LEFT JOIN processos pr ON pr.id = f.processo_id WHERE f.id = ?`).bind(lid).first();
  if (!l) return redirecionar("/sistema/financeiro");
  try {
    if (acao === "cancelar") {
      if (sessao.perfil !== "admin") return volta("permissao");
      await cancelarCobranca(env, l);
      await auditar(env, req, sessao.usuario_id, "asaas_cobranca_cancelada", `lançamento ${lid}: ${l.asaas_id}`);
      return volta("cancelada");
    }
    const forma = txt(f, "forma", 20);
    const p = await gerarCobranca(env, l, { forma });
    await auditar(env, req, sessao.usuario_id, "asaas_cobranca_gerada", `lançamento ${lid}: ${p.id}`);
    return volta("gerada");
  } catch (e) {
    return volta("erro", `&m=${encodeURIComponent(String(e.message).slice(0, 200))}`);
  }
}

// Bloco "Cobrança no Asaas" da tela do lançamento.
export function blocoCobranca(env, sessao, l, sp) {
  if (!asaasConfigurado(env) || !l?.id || l.tipo !== "receita") return { bloco: "", aviso: null, erro: null };
  const msg = sp.get("asaas");
  const aviso = msg === "gerada" ? "Cobrança gerada no Asaas. Envie o link ao cliente (o Asaas também avisa, conforme as notificações da conta)."
    : msg === "cancelada" ? "Cobrança cancelada no Asaas." : null;
  const erro = msg === "erro" ? `Asaas: ${sp.get("m") || "não foi possível concluir."}` : msg === "permissao" ? "Somente administradores podem cancelar cobranças."
    : msg === "sessao" ? "Sessão expirada. Tente novamente." : null;
  let corpo;
  if (l.asaas_id) {
    corpo = html`<dl class="ficha">
        <div><dt>Situação</dt><dd><span class="${`selo selo-asaas ${["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(l.asaas_status) ? "pago" : l.asaas_status === "OVERDUE" ? "vencida" : ""}`}">${STATUS[l.asaas_status] || l.asaas_status || "—"}</span></dd></div>
        <div><dt>Forma</dt><dd>${FORMAS[l.asaas_forma] || l.asaas_forma || "—"}</dd></div>
        <div><dt>Identificação</dt><dd>${l.asaas_id}</dd></div>
      </dl>
      ${l.asaas_link ? html`<p class="link-cobranca"><a class="botao-link botao-secundario" href="${l.asaas_link}" target="_blank" rel="noopener noreferrer">Abrir fatura / link de pagamento</a>
        <input type="text" readonly value="${l.asaas_link}" aria-label="Link de pagamento para copiar" class="campo-copiar"></p>` : ""}
      ${!l.pago ? html`<p class="dica">Mudou o valor ou o vencimento abaixo? A cobrança no Asaas não muda junto: cancele e gere de novo.</p>` : ""}
      ${sessao.perfil === "admin" && !l.pago ? html`<form method="post" action="/sistema/financeiro/${String(l.id)}/cobranca/cancelar" class="form-excluir-andamento"
          data-confirmar="Cancelar a cobrança no Asaas? O link de pagamento deixa de funcionar.">${campoCsrf(sessao)}<button type="submit" class="botao-perigo">Cancelar cobrança</button></form>` : ""}`;
  } else if (l.pago) {
    corpo = html`<p class="vazio">Lançamento já pago.</p>`;
  } else {
    corpo = html`<form method="post" action="/sistema/financeiro/${String(l.id)}/cobranca" class="formulario grade-form form-linha-cobranca"
        data-confirmar="${`Gerar cobrança de ${moeda(l.valor)} no Asaas, com vencimento em ${dataBR(l.vencimento)}?`}">${campoCsrf(sessao)}
        <label>Forma de pagamento<select name="forma" required>${opcoes(Object.entries(FORMAS), "UNDEFINED", "Selecione…")}</select></label>
        <div class="botoes-form"><button type="submit">Gerar cobrança no Asaas</button></div>
      </form>
      <p class="dica">O cliente precisa ter CPF/CNPJ no cadastro. Vencimento já passado vira hoje. O pagamento baixa este lançamento sozinho, com a conta "${CONTA_ASAAS}".</p>`;
  }
  return { bloco: html`<section class="cartao" id="cobranca"><h2>Cobrança no Asaas</h2>${corpo}</section>`, aviso, erro };
}

// ---------- Conciliação do extrato ----------
export async function conciliacao(req, env, sessao) {
  const url = new URL(req.url);
  const visao = ["conciliado", "ignorado"].includes(url.searchParams.get("visao")) ? url.searchParams.get("visao") : "pendente";
  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    const volta = (msg) => redirecionar(`/sistema/financeiro/conciliacao?msg=${msg}`);
    if (!ok) return volta("sessao");
    const acao = f.get("acao");
    if (acao === "sincronizar") {
      try { await sincronizar(env); } catch (e) { return redirecionar(`/sistema/financeiro/conciliacao?msg=erro&m=${encodeURIComponent(e.message.slice(0, 200))}`); }
      return volta("sync");
    }
    const mov = await env.DB.prepare("SELECT * FROM asaas_extrato WHERE id = ?").bind(String(f.get("mov") || "")).first();
    if (!mov) return volta("dados");
    const t = agora();
    if (acao === "ignorar") {
      await env.DB.prepare("UPDATE asaas_extrato SET situacao = 'ignorado' WHERE id = ?").bind(mov.id).run();
      return volta("ignorado");
    }
    if (acao === "reabrir") {
      await env.DB.prepare("UPDATE asaas_extrato SET situacao = 'pendente', financeiro_id = NULL WHERE id = ?").bind(mov.id).run();
      return volta("reaberto");
    }
    if (acao === "vincular") {
      const fid = Number(f.get("financeiro_id"));
      const l = fid ? await env.DB.prepare("SELECT id FROM financeiro WHERE id = ?").bind(fid).first() : null;
      if (!l) return volta("dados");
      await env.DB.batch([
        env.DB.prepare("UPDATE financeiro SET pago = 1, data_pagamento = COALESCE(data_pagamento, ?), conta = ?, atualizado_em = ? WHERE id = ?").bind(mov.data, CONTA_ASAAS, t, l.id),
        env.DB.prepare("UPDATE asaas_extrato SET situacao = 'conciliado', financeiro_id = ? WHERE id = ?").bind(l.id, mov.id),
      ]);
      await auditar(env, req, sessao.usuario_id, "asaas_conciliado", `extrato ${mov.id} → lançamento ${l.id}`);
      return volta("vinculado");
    }
    if (acao === "criar") {
      const categoria = txt(f, "categoria", 80);
      const descricao = txt(f, "descricao", 300) || mov.descricao || rotuloTipo(mov.tipo);
      const r = await env.DB.prepare(`INSERT INTO financeiro (tipo, categoria, descricao, valor, vencimento, pago, data_pagamento, conta, condicao, responsavel, criado_por, criado_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'À Vista', ?, ?, ?, ?)`)
        .bind(mov.valor >= 0 ? "receita" : "despesa", categoria, descricao, Math.abs(mov.valor), mov.data, mov.data, CONTA_ASAAS, sessao.nome, sessao.usuario_id, t, t).run();
      await env.DB.prepare("UPDATE asaas_extrato SET situacao = 'conciliado', financeiro_id = ? WHERE id = ?").bind(r.meta.last_row_id, mov.id).run();
      await auditar(env, req, sessao.usuario_id, "asaas_lancamento_criado", `extrato ${mov.id} → lançamento ${r.meta.last_row_id}`);
      return volta("criado");
    }
    return volta("dados");
  }
  const { results: movs } = await env.DB.prepare(`SELECT e.*, f.descricao AS lanc_descricao FROM asaas_extrato e LEFT JOIN financeiro f ON f.id = e.financeiro_id
      WHERE e.situacao = ? ORDER BY e.data DESC, e.id DESC LIMIT 300`).bind(visao).all();
  // Sugestões: lançamentos com o mesmo valor e tipo, até 7 dias de diferença, ainda não conciliados.
  const sugestoes = new Map();
  if (visao === "pendente") {
    for (const m of movs) {
      const { results } = await env.DB.prepare(`SELECT f.id, f.descricao, f.vencimento, f.pago, COALESCE(c.nome, c2.nome) AS cliente FROM financeiro f
          LEFT JOIN clientes c ON c.id = f.cliente_id LEFT JOIN processos pr ON pr.id = f.processo_id LEFT JOIN clientes c2 ON c2.id = pr.cliente_id
          WHERE f.tipo = ? AND ABS(f.valor - ?) < 0.01 AND ABS(julianday(COALESCE(f.data_pagamento, f.vencimento)) - julianday(?)) <= 7
            AND NOT EXISTS (SELECT 1 FROM asaas_extrato e WHERE e.financeiro_id = f.id) ORDER BY ABS(julianday(f.vencimento) - julianday(?)) LIMIT 5`)
        .bind(m.valor >= 0 ? "receita" : "despesa", Math.abs(m.valor), m.data, m.data).all();
      sugestoes.set(m.id, results);
    }
  }
  const cats = await categoriasFinanceiras(env);
  const [pend, ultima] = await Promise.all([env.DB.prepare("SELECT COUNT(*) AS n FROM asaas_extrato WHERE situacao = 'pendente'").first(), lerConfig(env, "asaas_ultima_sync")]);
  const msg = url.searchParams.get("msg");
  const avisos = { sync: "Extrato sincronizado.", ignorado: "Movimentação ignorada.", reaberto: "Movimentação reaberta.", vinculado: "Movimentação conciliada com o lançamento.", criado: "Lançamento criado e conciliado." };
  const erros = { sessao: "Sessão expirada. Tente novamente.", dados: "Não foi possível concluir. Recarregue a página.", erro: `Asaas: ${url.searchParams.get("m") || "erro na sincronização."}` };
  const categoriaPadrao = (m) => (/FEE$/.test(m.tipo || "") ? cats.despesa.find((c) => /tarifa|taxa|banc/i.test(c)) || "" : "");
  return resposta(pagina({
    titulo: "Conciliação Asaas", sessao, ...(avisos[msg] ? { aviso: avisos[msg] } : {}), ...(erros[msg] ? { erro: erros[msg] } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/financeiro">Financeiro</a></p>
      <div class="titulo-acoes"><h1>Conciliação Asaas</h1>
        ${asaasConfigurado(env) ? html`<form method="post" class="form-linha">${campoCsrf(sessao)}<button type="submit" name="acao" value="sincronizar" class="botao-secundario">Sincronizar agora</button></form>` : ""}</div>
      <p class="dica">Movimentações do extrato do Asaas. Recebimentos de cobranças emitidas pelo Diligo são conciliados sozinhos; o restante você vincula a um lançamento, cria um lançamento novo ou ignora. Última sincronização: ${quando(ultima)}.</p>
      <nav class="abas"><a href="/sistema/financeiro/conciliacao" class="${visao === "pendente" ? "ativa" : ""}">A conciliar (${String(pend?.n || 0)})</a>
        <a href="/sistema/financeiro/conciliacao?visao=conciliado" class="${visao === "conciliado" ? "ativa" : ""}">Conciliadas</a>
        <a href="/sistema/financeiro/conciliacao?visao=ignorado" class="${visao === "ignorado" ? "ativa" : ""}">Ignoradas</a></nav>
      ${movs.length ? html`<ul class="lista-conciliacao">${movs.map((m) => html`<li class="${m.valor >= 0 ? "entrada" : "saida"}">
        <div class="conc-mov"><span class="conc-data">${dataBR(m.data)}</span><strong class="${m.valor >= 0 ? "receita" : "despesa"}">${m.valor < 0 ? "− " : ""}${moeda(Math.abs(m.valor))}</strong>
          <span class="conc-tipo">${rotuloTipo(m.tipo)}</span><span class="conc-desc">${m.descricao || ""}</span></div>
        <div class="conc-acoes">
        ${visao === "pendente" ? html`
          ${(sugestoes.get(m.id) || []).length ? html`<form method="post" class="form-linha conc-form">${campoCsrf(sessao)}<input type="hidden" name="mov" value="${m.id}">
            <label>Vincular a<select name="financeiro_id" required>${opcoes(sugestoes.get(m.id).map((s) => [s.id, `${dataBR(s.vencimento)} · ${s.descricao}${s.cliente ? ` · ${s.cliente}` : ""}${s.pago ? " (pago)" : ""}`]), "", "Selecione…")}</select></label>
            <button type="submit" name="acao" value="vincular" class="botao-pequeno">Conciliar</button></form>` : ""}
          <details class="conc-criar"><summary class="botao-link botao-pequeno botao-secundario">Criar lançamento</summary>
            <form method="post" class="formulario grade-form">${campoCsrf(sessao)}<input type="hidden" name="mov" value="${m.id}">
              <label>Tipo de lançamento<select name="categoria">${opcoes((m.valor >= 0 ? cats.receita : cats.despesa).map((c) => [c, c]), categoriaPadrao(m), "Selecione…")}</select></label>
              <label class="duplo">Descrição<input name="descricao" maxlength="300" value="${m.descricao || rotuloTipo(m.tipo)}"></label>
              <div class="largo botoes-form"><button type="submit" name="acao" value="criar" class="botao-pequeno">Criar ${m.valor >= 0 ? "receita" : "despesa"} paga</button></div>
            </form></details>
          <form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="mov" value="${m.id}"><button type="submit" name="acao" value="ignorar" class="botao-pequeno botao-secundario">Ignorar</button></form>`
        : html`${m.financeiro_id ? html`<a href="/sistema/financeiro/${String(m.financeiro_id)}">${m.lanc_descricao || "ver lançamento"}</a>` : ""}
          <form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="mov" value="${m.id}"><button type="submit" name="acao" value="reabrir" class="botao-pequeno botao-secundario">Reabrir</button></form>`}
        </div></li>`)}</ul>`
        : html`<p class="vazio">${visao === "pendente" ? "Nada a conciliar." : "Nenhuma movimentação."}</p>`}`,
  }));
}
