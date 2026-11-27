// Espelhamento de prazos e compromissos na agenda do Outlook da conta Microsoft 365 conectada.
// O evento é criado quando o agendamento é salvo com "Espelhar no Outlook" e acompanha as mudanças:
// reagendar/mover atualiza a data, cumprir marca o título com ✔ e cancelar remove o evento.
import { graph, outlookLiberado } from "./microsoft.js";

const FUSO = "America/Sao_Paulo";
const br = (d) => (d ? d.split("-").reverse().join("/") : "");
const diaSeguinte = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const horaValida = (h) => (/^\d{2}:\d{2}/.test(h || "") ? h.slice(0, 5) : null);
const maisUmaHora = (h) => { const [a, b] = h.split(":").map(Number); const t = Math.min(a * 60 + b + 60, 23 * 60 + 59); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };

export function eventoDoPrazo(p, proc, origem) {
  const comp = p.categoria === "Compromisso";
  const data = p.prazo_interno || p.prazo_fatal;
  const hora = horaValida(p.hora) || (p.data_audiencia === data ? horaValida(p.hora_audiencia) : null);
  const rotuloPasta = proc?.pasta ? ` · Pasta ${proc.pasta}` : "";
  const assunto = `${p.situacao === "cumprido" ? "✔ " : ""}${comp ? "" : "Prazo: "}${p.titulo}${rotuloPasta}`;
  const linhas = [
    comp ? null : `Prazo fatal: ${br(p.prazo_fatal)}${p.prazo_interno && p.prazo_interno !== p.prazo_fatal ? ` · prazo interno: ${br(p.prazo_interno)}` : ""}`,
    p.situacao === "cumprido" ? `Cumprido em ${br(p.data_cumprimento)}.` : null,
    proc ? [proc.cliente_nome, proc.parte_contraria].filter(Boolean).join(" x ") || null : null,
    proc?.numero ? `Processo ${proc.numero}` : null,
    p.responsavel ? `Responsável: ${p.responsavel}` : null,
    p.descricao ? `\n${String(p.descricao).replace(/<[^>]+>/g, " ").slice(0, 4000)}` : null,
    `\nNo Diligo: ${origem}/sistema/prazos/${p.id}`,
  ].filter(Boolean);
  const evento = {
    subject: assunto.slice(0, 250),
    body: { contentType: "text", content: linhas.join("\n") },
    categories: [comp ? "Diligo · Compromisso" : "Diligo · Prazo"],
    showAs: p.situacao === "cumprido" ? "free" : hora ? "busy" : "free",
    isReminderOn: p.situacao !== "cumprido",
  };
  if (hora) Object.assign(evento, { isAllDay: false, start: { dateTime: `${data}T${hora}:00`, timeZone: FUSO }, end: { dateTime: `${data}T${maisUmaHora(hora)}:00`, timeZone: FUSO }, reminderMinutesBeforeStart: 60 });
  else Object.assign(evento, { isAllDay: true, start: { dateTime: `${data}T00:00:00`, timeZone: FUSO }, end: { dateTime: `${diaSeguinte(data)}T00:00:00`, timeZone: FUSO }, reminderMinutesBeforeStart: 15 * 60 });
  return evento;
}

// Cria, atualiza ou remove o evento conforme o estado atual do agendamento. Melhor esforço: nunca impede a gravação no Diligo.
export async function sincronizarOutlook(env, prazoId, origem = env.SITE_URL || "https://www.doniniadvocacia.com.br") {
  try {
    const p = await env.DB.prepare("SELECT * FROM prazos WHERE id = ?").bind(Number(prazoId)).first();
    if (!p || !p.outlook) return;
    if (!(await outlookLiberado(env))) throw new Error("agenda do Outlook não conectada");
    if (p.situacao === "cancelado") {
      if (p.outlook_evento) { try { await graph(env, `/me/events/${encodeURIComponent(p.outlook_evento)}`, { metodo: "DELETE" }); } catch (e) { if (!/404|não encontrad/i.test(e.message)) throw e; } }
      await env.DB.prepare("UPDATE prazos SET outlook_evento = NULL, outlook_erro = NULL WHERE id = ?").bind(p.id).run();
      return;
    }
    if (!(p.prazo_interno || p.prazo_fatal)) throw new Error("sem data");
    const proc = p.processo_id ? await env.DB.prepare("SELECT p.pasta, p.numero, p.parte_contraria, c.nome AS cliente_nome FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?").bind(p.processo_id).first() : null;
    const evento = eventoDoPrazo(p, proc, origem);
    let id = p.outlook_evento;
    if (id) {
      try { await graph(env, `/me/events/${encodeURIComponent(id)}`, { metodo: "PATCH", corpo: evento }); }
      catch (e) { if (/404|não encontrad/i.test(e.message)) id = null; else throw e; } // apagado no Outlook: cria de novo
    }
    if (!id) id = (await graph(env, "/me/events", { metodo: "POST", corpo: evento })).id;
    await env.DB.prepare("UPDATE prazos SET outlook_evento = ?, outlook_erro = NULL WHERE id = ?").bind(id, p.id).run();
  } catch (e) {
    console.error("Outlook:", e.message);
    await env.DB.prepare("UPDATE prazos SET outlook_erro = ? WHERE id = ?").bind(String(e.message).slice(0, 200), Number(prazoId)).run().catch(() => {});
  }
}
