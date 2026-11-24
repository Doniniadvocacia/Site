// Utilidades compartilhadas pelas telas da etapa 2.
import { html, seguro, h, dataBR, textoDeHtml } from "../html.js";
import { iguais } from "../seguranca.js";
import { hojeBR, somarDias } from "../calendario.js";

export const opcoes = (lista, selecionado, vazio = "—") =>
  seguro(`<option value="">${h(vazio)}</option>` + lista.map(([v, r]) =>
    `<option value="${h(v)}"${String(v) === String(selecionado ?? "") ? " selected" : ""}>${h(r)}</option>`).join(""));

export async function listasApoio(env) {
  const [{ results: procs }, { results: usuarios }] = await Promise.all([
    env.DB.prepare(`SELECT p.id, p.pasta, p.numero, c.nome AS cliente FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id
                    ORDER BY CAST(p.pasta AS INTEGER), p.pasta`).all(),
    env.DB.prepare("SELECT nome FROM usuarios WHERE ativo = 1 AND perfil != 'cliente' ORDER BY nome").all(),
  ]);
  return {
    processos: procs.map((p) => [p.id, [p.pasta && `Pasta ${p.pasta}`, p.numero, p.cliente].filter(Boolean).join(" · ")]),
    responsaveis: usuarios.map((u) => [u.nome, u.nome]),
  };
}

export async function csrfOk(req, sessao) {
  const f = await req.formData();
  return { f, ok: iguais(String(f.get("csrf") || ""), sessao.csrf) };
}

export const txt = (f, k, max = 2000) => { const v = String(f.get(k) ?? "").trim(); return v ? v.slice(0, max) : null; };
export const dataValida = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Etiqueta de urgência para a data fatal.
export function urgencia(fatal, situacao = "aberto") {
  if (situacao !== "aberto" || !fatal) return "";
  const hoje = hojeBR();
  if (fatal < hoje) return html`<span class="selo selo-vencido">Vencido</span>`;
  if (fatal === hoje) return html`<span class="selo selo-hoje">Hoje</span>`;
  if (fatal === somarDias(hoje, 1)) return html`<span class="selo selo-amanha">Amanhã</span>`;
  if (fatal <= somarDias(hoje, 7)) return html`<span class="selo selo-semana">7 dias</span>`;
  return "";
}

// Valor em reais digitado como "15.000,50", "15000,50" ou "15000.50". Vazio → null; inválido → NaN.
export function numeroBR(v) {
  const s = String(v ?? "").replace(/R\$|\s/g, "").trim();
  if (!s) return null;
  // "15.000" e "1.500.000" (pontos de milhar, sem centavos) também são aceitos.
  const n = Number(s.includes(",") || /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const rotuloProcesso = (p) => [p.pasta && `Pasta ${p.pasta}`, p.numero].filter(Boolean).join(" · ") || "—";
export { dataBR };

// Descrição padrão de um prazo criado a partir de uma intimação: identificação + teor em texto simples.
export function descricaoDaIntimacao(pub) {
  const origem = [pub.tipo || "Intimação", pub.tribunal, pub.data_disponibilizacao && `disponibilizada em ${dataBR(pub.data_disponibilizacao)}`].filter(Boolean).join(" · ");
  const teor = textoDeHtml(pub.texto);
  return `${origem}${pub.numero_processo ? `\nProcesso ${pub.numero_processo}` : ""}${teor ? `\n\n${teor}` : ""}`.slice(0, 20000);
}

// Bloco recolhível; abre por padrão.
export const bloco = (titulo, corpo, { id = "", acoes = "", aberto = true, contagem = null } = {}) => html`
  <details class="bloco"${id ? html` id="${id}"` : ""}${aberto ? html` open` : ""}>
    <summary><h2>${titulo}${contagem !== null ? html` <span class="contagem">${String(contagem)}</span>` : ""}</h2><span class="bloco-acoes">${acoes}</span><span class="seta" aria-hidden="true"></span></summary>
    <div class="bloco-corpo">${corpo}</div>
  </details>`;
