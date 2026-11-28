// Análise automática das intimações com a API da Anthropic (Claude).
// A IA só sugere: classifica, escolhe o tipo de prazo da lista do escritório, informa os dias e resume a determinação.
// As datas são calculadas pelo calendário do sistema e nada vira prazo sem a aprovação de um usuário.
import { agora } from "./seguranca.js";
import { textoDeHtml } from "./html.js";
import { obterListas, prazosPadrao } from "./listas.js";

const API_PADRAO = "https://api.anthropic.com/v1/messages";
const MODELO_PADRAO = "claude-sonnet-5-5";
const MAX_TENTATIVAS = 3;
const MAX_TEXTO = 30000;

// Chave de pausa de emergência: com true, nenhuma análise de intimação por IA é iniciada,
// nem automática (captura, abertura da triagem) nem manual. Para reativar, voltar para false e publicar.
export const IA_PAUSADA = false;
export const iaConfigurada = (env) => !IA_PAUSADA && !!env.ANTHROPIC_API_KEY;

const ESQUEMA = {
  type: "object",
  properties: {
    gera_prazo: { type: "boolean", description: "true se a intimação exige alguma providência do escritório com prazo ou designa audiência/sessão" },
    categoria: { type: "string", enum: ["Prazo", "Compromisso", "Nenhum"], description: "Lista a que pertence o tipo escolhido (prazos ou compromissos); Nenhum se não gera prazo" },
    tipo: { type: "string", description: "Exatamente um dos tipos da lista fornecida (de prazo ou de compromisso). Vazio se não gera prazo." },
    titulo: { type: "string", description: "Título curto do prazo, até 60 caracteres, ex.: 'Contrarrazões à apelação'" },
    dias: { type: "integer", description: "Número de dias do prazo; 0 se não houver prazo em dias (compromisso ou sem prazo)" },
    contagem: { type: "string", enum: ["uteis", "corridos"] },
    data_evento: { type: "string", description: "Data do ato marcado (audiência, sessão, perícia) no formato AAAA-MM-DD; vazio se não houver" },
    hora_evento: { type: "string", description: "Hora do ato marcado (HH:MM) quando informada; vazio caso contrário" },
    resumo: { type: "string", description: "O que foi decidido ou determinado, em 1 a 3 frases, em português" },
    providencia: { type: "string", description: "O que o escritório precisa fazer, em uma frase; vazio se nada" },
    destinatario_cliente: { type: "boolean", description: "true se a determinação se dirige à parte representada pelo escritório (ou a ambas)" },
    urgente: { type: "boolean", description: "true para tutela de urgência, prazo de 5 dias ou menos, audiência próxima, bloqueio de valores ou risco de preclusão grave" },
    alertas: { type: "array", items: { type: "string" }, description: "Pontos de atenção curtos (ex.: 'sentença de improcedência', 'prazo em horas')" },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
    justificativa: { type: "string", description: "Por que escolheu esse tipo e esses dias, citando o trecho ou o artigo de lei, em até 2 frases" },
  },
  required: ["gera_prazo", "categoria", "tipo", "titulo", "dias", "contagem", "data_evento", "hora_evento", "resumo", "providencia",
    "destinatario_cliente", "urgente", "alertas", "confianca", "justificativa"],
  additionalProperties: false,
};

const INSTRUCOES = `Você é um assistente de controladoria jurídica de um escritório de advocacia brasileiro (Eduardo Donini Advocacia).
Recebe o teor de uma intimação do Diário de Justiça Eletrônico Nacional (DJEN) e os dados do processo no cadastro do escritório.
Sua tarefa é sugerir como a intimação deve ser registrada na agenda. Um advogado vai revisar e aprovar a sua sugestão.

Regras:
- Responda sempre em português do Brasil.
- Use somente os tipos de prazo e de compromisso da lista fornecida, escrevendo-os exatamente como estão. Se nenhum servir, use o mais próximo (por exemplo "Manifestação") e explique na justificativa.
- Informe apenas o NÚMERO DE DIAS e a forma de contagem. Não calcule a data final: o sistema calcula a partir da data de publicação, com feriados e recesso forense.
- Se o próprio despacho fixar o prazo (ex.: "no prazo de 5 dias"), use esse número. Se não fixar, use o prazo legal aplicável (CPC, CLT, Lei 9.099/95 etc.) ou o padrão do tipo informado na lista.
- Prazos processuais cíveis e trabalhistas contam em dias úteis; use "corridos" só quando a lei ou a decisão determinar (ex.: prazos materiais, prazos em dias corridos fixados pelo juízo).
- Audiência, sessão de julgamento, perícia ou outro ato com data marcada: dias = 0 e data_evento/hora_evento preenchidos com o que constar do teor. Escolha o tipo correspondente em qualquer das duas listas (ex.: "Audiência de Conciliação"); categoria = "Prazo" se o tipo estiver na lista de prazos, "Compromisso" se estiver na lista de compromissos.
- Atos de mera ciência, juntadas, conclusões, remessas, certidões e despachos ordinatórios que não exigem providência do escritório: gera_prazo = false, categoria "Nenhum", tipo vazio, dias = 0.
- Considere a posição do cliente no processo para saber se a determinação se dirige à parte representada pelo escritório. Se for dirigida apenas à parte contrária e não exigir nada do escritório, normalmente não gera prazo; registre isso nos alertas.
- Sentenças e acórdãos geram prazo recursal para a parte vencida e, em geral, também devem ser registrados (por exemplo, para avaliar embargos de declaração ou recurso); indique o resultado nos alertas.
- Em caso de dúvida, prefira sugerir o prazo (o advogado pode arquivar) e use confiança "baixa" ou "media".
- Não invente fatos que não estejam no teor.`;

async function contexto(env, pub) {
  const proc = pub.processo_id
    ? await env.DB.prepare(`SELECT p.pasta, p.numero, p.tipo_acao, p.fase, p.posicao_cliente, p.parte_contraria, p.vara, p.comarca, p.uf, p.rito,
        c.nome AS cliente FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`).bind(pub.processo_id).first()
    : null;
  const [listas, padroes] = await Promise.all([obterListas(env, ["tipo_prazo", "tipo_compromisso"]), prazosPadrao(env)]);
  return { proc, tiposPrazo: listas.tipo_prazo || [], tiposCompromisso: listas.tipo_compromisso || [], padroes };
}

function montarPergunta(pub, ctx) {
  const linhas = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const prazos = ctx.tiposPrazo.map((t) => {
    const p = ctx.padroes[t];
    return `- ${t}${p ? ` (padrão: ${p.dias} dias ${p.contagem === "corridos" ? "corridos" : "úteis"})` : ""}`;
  }).join("\n");
  const teor = textoDeHtml(pub.texto).replace(/\n{3,}/g, "\n\n").slice(0, MAX_TEXTO);
  return `Dados da intimação:
${linhas({ Tribunal: pub.tribunal, Órgão: pub.orgao, "Tipo de comunicação": pub.tipo, "Número do processo": pub.numero_processo,
    "Data de disponibilização": pub.data_disponibilizacao, "Data de publicação (início da contagem)": pub.data_publicacao })}

Processo no cadastro do escritório:
${ctx.proc ? linhas({ Pasta: ctx.proc.pasta, Cliente: ctx.proc.cliente, "Posição do cliente": ctx.proc.posicao_cliente, "Parte contrária": ctx.proc.parte_contraria,
    Ação: ctx.proc.tipo_acao, Rito: ctx.proc.rito, Fase: ctx.proc.fase, "Vara / órgão": ctx.proc.vara, Comarca: [ctx.proc.comarca, ctx.proc.uf].filter(Boolean).join("/") }) || "- (sem dados)" : "- Processo não localizado no cadastro."}

Tipos de prazo do escritório:
${prazos || "- (lista vazia)"}

Tipos de compromisso do escritório:
${ctx.tiposCompromisso.map((t) => `- ${t}`).join("\n") || "- (lista vazia)"}

Teor da intimação:
"""
${teor || "(sem texto)"}
"""`;
}

// Ajusta a resposta para o que o sistema aceita (tipo existente na lista, números válidos etc.).
function validar(s, ctx) {
  const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const achar = (lista) => lista.find((t) => norm(t) === norm(s.tipo)) || "";
  const tipoPrazo = achar(ctx.tiposPrazo), tipoComp = achar(ctx.tiposCompromisso);
  const alertas = (Array.isArray(s.alertas) ? s.alertas : []).map((a) => String(a).slice(0, 160)).slice(0, 6);
  // A categoria segue a lista em que o tipo está (no escritório, audiências ficam entre os tipos de prazo).
  let categoria = "Nenhum", tipo = "";
  if (s.gera_prazo) {
    if (tipoPrazo && (s.categoria !== "Compromisso" || !tipoComp)) { categoria = "Prazo"; tipo = tipoPrazo; }
    else if (tipoComp) { categoria = "Compromisso"; tipo = tipoComp; }
    else { categoria = s.categoria === "Compromisso" ? "Compromisso" : "Prazo"; if (s.tipo) alertas.push(`Tipo sugerido "${String(s.tipo).slice(0, 60)}" não está na lista do escritório: escolha o tipo`); }
  }
  const data = /^\d{4}-\d{2}-\d{2}$/.test(s.data_evento || "") ? s.data_evento : "";
  const hora = /^\d{2}:\d{2}$/.test(s.hora_evento || "") ? s.hora_evento : "";
  const dias = categoria === "Nenhum" ? 0 : Math.max(0, Math.min(365, Math.round(Number(s.dias) || 0)));
  return {
    gera_prazo: categoria !== "Nenhum",
    categoria,
    tipo,
    titulo: String(s.titulo || tipo || "").slice(0, 120),
    dias,
    contagem: s.contagem === "corridos" ? "corridos" : "uteis",
    data_evento: categoria !== "Nenhum" ? data : "",
    hora_evento: categoria !== "Nenhum" && data ? hora : "",
    resumo: String(s.resumo || "").slice(0, 800),
    providencia: String(s.providencia || "").slice(0, 300),
    destinatario_cliente: !!s.destinatario_cliente,
    urgente: !!s.urgente,
    alertas,
    confianca: ["alta", "media", "baixa"].includes(s.confianca) ? s.confianca : "baixa",
    justificativa: String(s.justificativa || "").slice(0, 600),
  };
}

async function chamarApi(env, pergunta) {
  const r = await fetch(env.ANTHROPIC_API || API_PADRAO, {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.IA_MODELO || MODELO_PADRAO,
      max_tokens: 2000,
      system: INSTRUCOES,
      messages: [{ role: "user", content: pergunta }],
      output_config: { format: { type: "json_schema", schema: ESQUEMA } },
    }),
  });
  if (!r.ok) {
    const corpo = (await r.text()).slice(0, 300);
    let msg = corpo;
    try { msg = JSON.parse(corpo)?.error?.message || corpo; } catch { /* corpo não é JSON */ }
    throw new Error(r.status === 401 ? "Chave da API da Anthropic inválida (401)." : `API da Anthropic respondeu ${r.status}: ${msg}`);
  }
  const j = await r.json();
  if (j.stop_reason === "refusal") throw new Error("A IA recusou analisar esta intimação.");
  if (j.stop_reason === "max_tokens") throw new Error("Resposta da IA incompleta (limite de tamanho).");
  const texto = (j.content || []).find((c) => c.type === "text")?.text;
  if (!texto) throw new Error("Resposta da IA sem conteúdo.");
  return { dados: JSON.parse(texto), modelo: j.model || env.IA_MODELO || MODELO_PADRAO };
}

// Analisa uma intimação e grava a sugestão. Retorna a sugestão (ou lança erro, já registrado na intimação).
export async function analisarIntimacao(env, id) {
  if (IA_PAUSADA) return null;
  const pub = await env.DB.prepare("SELECT * FROM publicacoes WHERE id = ?").bind(Number(id)).first();
  if (!pub) throw new Error("Intimação não encontrada.");
  const ctx = await contexto(env, pub);
  try {
    const { dados, modelo } = await chamarApi(env, montarPergunta(pub, ctx));
    const sugestao = { ...validar(dados, ctx), modelo };
    await env.DB.prepare("UPDATE publicacoes SET ia_status = 'pronta', ia_sugestao = ?, ia_erro = NULL, ia_em = ?, ia_tentativas = ia_tentativas + 1 WHERE id = ?")
      .bind(JSON.stringify(sugestao), agora(), pub.id).run();
    return sugestao;
  } catch (e) {
    await env.DB.prepare("UPDATE publicacoes SET ia_status = 'erro', ia_erro = ?, ia_em = ?, ia_tentativas = ia_tentativas + 1 WHERE id = ?")
      .bind(String(e.message).slice(0, 400), agora(), pub.id).run();
    throw e;
  }
}

// Analisa as intimações pendentes ainda sem sugestão (e repete as que falharam, até 3 tentativas, com intervalo de 30 min).
export async function analisarPendentes(env, limite = 15) {
  if (IA_PAUSADA) return { analisadas: 0, pausada: true };
  if (!iaConfigurada(env)) return { analisadas: 0, erros: 0 };
  const { results } = await env.DB.prepare(`SELECT id FROM publicacoes WHERE situacao = 'pendente'
      AND (ia_status IS NULL OR (ia_status = 'erro' AND ia_tentativas < ? AND ia_em < ?)) ORDER BY id LIMIT ?`)
    .bind(MAX_TENTATIVAS, agora() - 1800, limite).all();
  let analisadas = 0, erros = 0;
  for (const { id } of results) {
    try { await analisarIntimacao(env, id); analisadas++; } catch (e) { erros++; console.error("IA intimação", id, e.message); }
  }
  return { analisadas, erros };
}

export const lerSugestao = (pub) => { try { return pub.ia_sugestao ? JSON.parse(pub.ia_sugestao) : null; } catch { return null; } };
