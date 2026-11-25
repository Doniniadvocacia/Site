// Integração com o Asaas (https://docs.asaas.com): cliente da API, avisos (webhook) e sincronização.
// A chave fica no segredo ASAAS_API_KEY (nunca no código). O token dos avisos é gerado aqui e guardado cifrado.
import { agora, cifrar, decifrar, iguais, tokenAleatorio } from "./seguranca.js";
import { hojeBR, somarDias } from "./calendario.js";
import { notificar, idsPorPerfil } from "./notificacoes.js";

const API_PADRAO = "https://api.asaas.com/v3";
export const asaasConfigurado = (env) => Boolean(env.ASAAS_API_KEY);

export const FORMAS = { BOLETO: "Boleto", PIX: "Pix", CREDIT_CARD: "Cartão de Crédito", UNDEFINED: "Boleto, Pix ou cartão (cliente escolhe)" };
export const STATUS = {
  PENDING: "Aguardando pagamento", OVERDUE: "Vencida", RECEIVED: "Recebida", CONFIRMED: "Confirmada", RECEIVED_IN_CASH: "Recebida em dinheiro",
  REFUNDED: "Estornada", REFUND_REQUESTED: "Estorno solicitado", REFUND_IN_PROGRESS: "Estorno em andamento", CHARGEBACK_REQUESTED: "Chargeback",
  CHARGEBACK_DISPUTE: "Em disputa", AWAITING_CHARGEBACK_REVERSAL: "Aguardando reversão", DUNNING_REQUESTED: "Em negativação",
  DUNNING_RECEIVED: "Recuperada", AWAITING_RISK_ANALYSIS: "Em análise", DELETED: "Cancelada",
};
const PAGOS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);
const ESTORNADOS = new Set(["REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "DELETED"]);
const FORMA_DILIGO = { BOLETO: "Boleto", PIX: "Pix", CREDIT_CARD: "Cartão de Crédito", DEBIT_CARD: "Cartão de Débito", TRANSFER: "Transferência", DEPOSIT: "Crédito em Conta" };
export const CONTA_ASAAS = "Asaas";
export const referencia = (financeiroId) => `diligo-${financeiroId}`;

// ---------- Chamadas à API ----------
export async function asaas(env, metodo, caminho, corpo = null) {
  if (!asaasConfigurado(env)) throw new Error("Integração com o Asaas não configurada (falta a chave ASAAS_API_KEY).");
  const r = await fetch(`${env.ASAAS_API || API_PADRAO}${caminho}`, {
    method: metodo,
    headers: { access_token: env.ASAAS_API_KEY, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Diligo/1.0 (Eduardo Donini Advocacia)" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let j = null;
  try { j = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }
  if (!r.ok) {
    const msg = j?.errors?.map((e) => e.description).filter(Boolean).join(" ") || `Asaas respondeu ${r.status}.`;
    const erro = new Error(r.status === 401 ? "Chave do Asaas inválida ou desativada." : r.status === 403 ? `Acesso negado pelo Asaas (403). Confira as permissões da chave e se a lista de IPs autorizados está desligada. ${msg}` : msg);
    erro.status = r.status;
    throw erro;
  }
  return j;
}

// Lista paginada (máx. 100 por página).
async function listar(env, caminho, maxPaginas = 20) {
  const itens = [];
  for (let p = 0; p < maxPaginas; p++) {
    const j = await asaas(env, "GET", `${caminho}${caminho.includes("?") ? "&" : "?"}limit=100&offset=${p * 100}`);
    itens.push(...(j?.data || []));
    if (!j?.hasMore) break;
  }
  return itens;
}

// ---------- Configurações gravadas ----------
export async function lerConfig(env, chave) {
  return (await env.DB.prepare("SELECT valor FROM configuracoes WHERE chave = ?").bind(chave).first())?.valor ?? null;
}
export async function gravarConfig(env, chave, valor, usuarioId = null) {
  await env.DB.prepare("INSERT INTO configuracoes (chave, valor, atualizado_por, atualizado_em) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(chave) DO UPDATE SET valor = ?2, atualizado_por = ?3, atualizado_em = ?4")
    .bind(chave, valor, usuarioId, agora()).run();
}

// Saldo da conta Asaas, guardado por 10 minutos para não consultar a cada página.
export async function saldoAsaas(env, { forcar = false } = {}) {
  if (!asaasConfigurado(env)) return null;
  const guardado = await lerConfig(env, "asaas_saldo");
  if (guardado && !forcar) {
    try { const g = JSON.parse(guardado); if (agora() - g.em < 600) return g; } catch { /* refaz */ }
  }
  try {
    const j = await asaas(env, "GET", "/finance/balance");
    const g = { saldo: Number(j?.balance) || 0, em: agora() };
    await gravarConfig(env, "asaas_saldo", JSON.stringify(g));
    return g;
  } catch (e) { return { erro: e.message }; }
}

// ---------- Clientes ----------
// Cliente do Diligo ↔ cliente do Asaas, pelo CPF/CNPJ (procura antes de criar, para não duplicar).
export async function garantirClienteAsaas(env, clienteId) {
  const c = await env.DB.prepare("SELECT id, nome, asaas_id, documento_enc, email_enc, telefone_enc FROM clientes WHERE id = ?").bind(clienteId).first();
  if (!c) throw new Error("Cliente não encontrado.");
  if (c.asaas_id) return c.asaas_id;
  const [doc, email, fone] = await Promise.all([decifrar(env, c.documento_enc), decifrar(env, c.email_enc), decifrar(env, c.telefone_enc)]);
  const cpfCnpj = String(doc || "").replace(/\D/g, "");
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) throw new Error("Para gerar cobrança no Asaas, o cliente precisa ter CPF ou CNPJ cadastrado.");
  const achado = await asaas(env, "GET", `/customers?cpfCnpj=${cpfCnpj}`);
  let id = achado?.data?.find((x) => !x.deleted)?.id;
  if (!id) {
    const novo = await asaas(env, "POST", "/customers", {
      name: c.nome, cpfCnpj, email: email || undefined, mobilePhone: String(fone || "").replace(/\D/g, "") || undefined, externalReference: `diligo-cliente-${c.id}`,
    });
    id = novo.id;
  }
  await env.DB.prepare("UPDATE clientes SET asaas_id = ? WHERE id = ?").bind(id, c.id).run();
  return id;
}

// ---------- Cobranças ----------
export async function gerarCobranca(env, lancamento, { forma }) {
  if (lancamento.tipo !== "receita") throw new Error("Só lançamentos de receita geram cobrança.");
  if (lancamento.pago) throw new Error("Este lançamento já está pago.");
  if (lancamento.asaas_id && lancamento.asaas_status !== "DELETED") throw new Error("Este lançamento já tem cobrança no Asaas.");
  const clienteId = lancamento.cliente_id || lancamento.cliente_processo_id;
  if (!clienteId) throw new Error("Vincule um cliente ao lançamento antes de gerar a cobrança.");
  if (!FORMAS[forma]) throw new Error("Escolha a forma de pagamento.");
  const customer = await garantirClienteAsaas(env, clienteId);
  const vencimento = lancamento.vencimento < hojeBR() ? hojeBR() : lancamento.vencimento;
  const parcela = lancamento.parcelas > 1 ? ` (parcela ${lancamento.parcela}/${lancamento.parcelas})` : "";
  const p = await asaas(env, "POST", "/payments", {
    customer, billingType: forma, value: Math.round(lancamento.valor * 100) / 100, dueDate: vencimento,
    description: `${lancamento.descricao}${parcela}`.slice(0, 500), externalReference: referencia(lancamento.id),
  });
  await env.DB.prepare("UPDATE financeiro SET asaas_id = ?, asaas_status = ?, asaas_link = ?, asaas_forma = ?, conta = COALESCE(NULLIF(conta, ''), ?), atualizado_em = ? WHERE id = ?")
    .bind(p.id, p.status || "PENDING", p.invoiceUrl || null, forma, CONTA_ASAAS, agora(), lancamento.id).run();
  return p;
}

export async function cancelarCobranca(env, lancamento) {
  if (!lancamento.asaas_id) throw new Error("Este lançamento não tem cobrança no Asaas.");
  if (PAGOS.has(lancamento.asaas_status)) throw new Error("A cobrança já foi paga; para devolver o valor, faça o estorno no Asaas.");
  try { await asaas(env, "DELETE", `/payments/${encodeURIComponent(lancamento.asaas_id)}`); } catch (e) { if (e.status !== 404) throw e; }
  await env.DB.prepare("UPDATE financeiro SET asaas_id = NULL, asaas_status = NULL, asaas_link = NULL, asaas_forma = NULL, atualizado_em = ? WHERE id = ?").bind(agora(), lancamento.id).run();
}

// Aplica no lançamento o estado de uma cobrança do Asaas. Devolve o que foi feito.
export async function aplicarCobranca(env, p) {
  if (!p?.id) return { resultado: "sem cobrança" };
  const ref = /^diligo-(\d+)$/.exec(p.externalReference || "");
  let l = await env.DB.prepare("SELECT id, pago, data_pagamento, asaas_id FROM financeiro WHERE asaas_id = ?").bind(p.id).first();
  if (!l && ref) l = await env.DB.prepare("SELECT id, pago, data_pagamento, asaas_id FROM financeiro WHERE id = ? AND (asaas_id IS NULL OR asaas_id = ?)").bind(Number(ref[1]), p.id).first();
  if (!l) return { resultado: "sem lançamento" };
  const status = p.deleted ? "DELETED" : p.status;
  const t = agora();
  if (PAGOS.has(status)) {
    const data = String(p.clientPaymentDate || p.paymentDate || p.confirmedDate || hojeBR()).slice(0, 10);
    await env.DB.prepare(`UPDATE financeiro SET asaas_id = ?, asaas_status = ?, asaas_link = COALESCE(?, asaas_link), pago = 1, data_pagamento = ?,
        forma_pagamento = COALESCE(?, forma_pagamento), conta = ?, atualizado_em = ? WHERE id = ?`)
      .bind(p.id, status, p.invoiceUrl || null, data, FORMA_DILIGO[p.billingType] || null, CONTA_ASAAS, t, l.id).run();
    return { resultado: l.pago ? "já estava pago" : "baixado", financeiroId: l.id };
  }
  if (ESTORNADOS.has(status) && l.pago) {
    await env.DB.prepare("UPDATE financeiro SET asaas_status = ?, pago = 0, data_pagamento = NULL, atualizado_em = ? WHERE id = ?").bind(status, t, l.id).run();
    return { resultado: "estornado", financeiroId: l.id };
  }
  await env.DB.prepare("UPDATE financeiro SET asaas_id = ?, asaas_status = ?, asaas_link = COALESCE(?, asaas_link), atualizado_em = ? WHERE id = ?")
    .bind(p.id, status, p.invoiceUrl || null, t, l.id).run();
  return { resultado: "atualizado", financeiroId: l.id };
}

// ---------- Avisos (webhook) ----------
export const EVENTOS = ["PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_DELETED",
  "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_RECEIVED_IN_CASH_UNDONE", "PAYMENT_CHARGEBACK_REQUESTED"];

export async function ativarAvisos(env, url, email, usuarioId) {
  const token = tokenAleatorio(32);
  const existente = await lerConfig(env, "asaas_webhook_id");
  const corpo = { name: "Diligo - baixa automática", url, email, enabled: true, interrupted: false, apiVersion: 3, authToken: token, sendType: "SEQUENTIALLY", events: EVENTOS };
  let w;
  if (existente) {
    try { w = await asaas(env, "PUT", `/webhooks/${encodeURIComponent(existente)}`, corpo); } catch (e) { if (e.status !== 404) throw e; }
  }
  if (!w) w = await asaas(env, "POST", "/webhooks", corpo);
  await gravarConfig(env, "asaas_webhook_id", w.id, usuarioId);
  await gravarConfig(env, "asaas_webhook_token", await cifrar(env, token), usuarioId);
  await gravarConfig(env, "asaas_webhook_url", url, usuarioId);
  return w;
}

// Recebe o aviso: confere o token, ignora repetidos, aplica e responde 200 rápido.
export async function receberAviso(req, env) {
  const resposta = (status, texto = "") => new Response(texto, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const guardado = await lerConfig(env, "asaas_webhook_token");
  const token = guardado ? await decifrar(env, guardado) : null;
  if (!token || !iguais(req.headers.get("asaas-access-token") || "", token)) return resposta(401, "Token inválido");
  let ev;
  try { ev = await req.json(); } catch { return resposta(400, "JSON inválido"); }
  if (!ev?.id || !ev?.event) return resposta(400, "Aviso incompleto");
  const novo = await env.DB.prepare("INSERT OR IGNORE INTO asaas_eventos (id, tipo, cobranca_id, recebido_em) VALUES (?, ?, ?, ?)")
    .bind(String(ev.id).slice(0, 80), String(ev.event).slice(0, 60), ev.payment?.id || null, agora()).run();
  if (!novo.meta.changes) return resposta(200, "Já processado");
  let r = { resultado: "ignorado" };
  if (ev.payment) {
    const p = ev.event === "PAYMENT_DELETED" ? { ...ev.payment, deleted: true } : ev.payment;
    r = await aplicarCobranca(env, p);
  }
  await env.DB.prepare("UPDATE asaas_eventos SET financeiro_id = ?, resultado = ? WHERE id = ?").bind(r.financeiroId || null, r.resultado, String(ev.id).slice(0, 80)).run();
  if (r.resultado === "baixado") {
    const l = await env.DB.prepare("SELECT descricao, valor FROM financeiro WHERE id = ?").bind(r.financeiroId).first();
    const valor = Number(l?.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await notificar(env, { destinos: await idsPorPerfil(env, ["admin"]), tipo: "asaas", link: `/sistema/financeiro/${r.financeiroId}`, texto: `Pagamento recebido no Asaas: ${valor} · ${l?.descricao || "lançamento"}` });
  }
  return resposta(200, "OK");
}

// ---------- Sincronização (reserva dos avisos e extrato para conciliação) ----------
export async function sincronizar(env, { dias = 45 } = {}) {
  if (!asaasConfigurado(env)) return { erro: "Integração não configurada." };
  const inicio = somarDias(hojeBR(), -dias), fim = hojeBR();
  const resumo = { cobrancas: 0, baixados: 0, extrato: 0, conciliados: 0 };
  // 1) Cobranças emitidas pelo Diligo ainda em aberto: confere o estado atual.
  const { results: abertas } = await env.DB.prepare("SELECT asaas_id FROM financeiro WHERE asaas_id IS NOT NULL AND pago = 0 LIMIT 200").all();
  for (const a of abertas) {
    try {
      const p = await asaas(env, "GET", `/payments/${encodeURIComponent(a.asaas_id)}`);
      resumo.cobrancas++;
      if ((await aplicarCobranca(env, p)).resultado === "baixado") resumo.baixados++;
    } catch (e) { if (e.status === 404) await aplicarCobranca(env, { id: a.asaas_id, deleted: true }); }
  }
  // 2) Cobranças recebidas no período com referência do Diligo (inclusive as emitidas direto no Asaas com a referência).
  for (const p of await listar(env, `/payments?paymentDate[ge]=${inicio}&paymentDate[le]=${fim}`, 10)) {
    if ((await aplicarCobranca(env, p)).resultado === "baixado") resumo.baixados++;
  }
  // 3) Extrato do período.
  const movs = await listar(env, `/financialTransactions?startDate=${inicio}&finishDate=${fim}&order=asc`, 20);
  const t = agora();
  for (const m of movs) {
    if (!m?.id) continue;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO asaas_extrato (id, data, tipo, valor, descricao, cobranca_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(String(m.id), String(m.date || fim).slice(0, 10), m.type || null, Number(m.value) || 0, (m.description || "").slice(0, 300), m.paymentId || null, t).run();
    resumo.extrato += r.meta.changes;
  }
  resumo.conciliados = await conciliarAutomatico(env);
  await gravarConfig(env, "asaas_ultima_sync", String(t));
  await saldoAsaas(env, { forcar: true });
  return resumo;
}

// Concilia sozinho o que tem vínculo certo: recebimento de cobrança emitida pelo Diligo.
export async function conciliarAutomatico(env) {
  const r = await env.DB.prepare(`UPDATE asaas_extrato SET situacao = 'conciliado',
      financeiro_id = (SELECT f.id FROM financeiro f WHERE f.asaas_id = asaas_extrato.cobranca_id)
    WHERE situacao = 'pendente' AND tipo = 'PAYMENT_RECEIVED' AND cobranca_id IS NOT NULL AND EXISTS (SELECT 1 FROM financeiro f WHERE f.asaas_id = asaas_extrato.cobranca_id)`).run();
  return r.meta.changes;
}
