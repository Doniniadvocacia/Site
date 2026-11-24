// Utilidades compartilhadas pelas telas da etapa 2.
import { html, seguro, h, dataBR, textoDeHtml } from "../html.js";
import { iguais } from "../seguranca.js";
import { hojeBR, somarDias } from "../calendario.js";
import { obterListas, prazosPadrao } from "../listas.js";

export const opcoes = (lista, selecionado, vazio = "—") =>
  seguro(`<option value="">${h(vazio)}</option>` + lista.map(([v, r]) =>
    `<option value="${h(v)}"${String(v) === String(selecionado ?? "") ? " selected" : ""}>${h(r)}</option>`).join(""));

export async function listasApoio(env) {
  const [{ results: procs }, { results: usuarios }, tipos, padroes] = await Promise.all([
    env.DB.prepare(`SELECT p.id, p.pasta, p.numero, c.nome AS cliente FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id
                    ORDER BY CAST(p.pasta AS INTEGER), p.pasta`).all(),
    env.DB.prepare("SELECT nome FROM usuarios WHERE ativo = 1 AND perfil != 'cliente' ORDER BY nome").all(),
    obterListas(env, ["tipo_prazo", "tipo_compromisso"]),
    prazosPadrao(env),
  ]);
  return {
    processos: procs.map((p) => [p.id, [p.pasta && `Pasta ${p.pasta}`, p.numero, p.cliente].filter(Boolean).join(" · ")]),
    responsaveis: usuarios.map((u) => [u.nome, u.nome]),
    tipos: { Prazo: tipos.tipo_prazo, Compromisso: tipos.tipo_compromisso },
    padroes,
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

// Cabeçalho comum da Agenda (calendário, prazos e compromissos ficam na mesma página).
export const cabecalhoAgenda = (ativa) => html`
  <div class="titulo-acoes"><h1>Agenda</h1><a class="botao-link" href="/sistema/prazos/novo">Novo agendamento</a></div>
  <nav class="abas">
    <a href="/sistema/agenda" class="${ativa === "calendario" ? "ativa" : ""}">Calendário</a>
    <a href="/sistema/agenda?visao=prazos" class="${ativa === "prazos" ? "ativa" : ""}">Prazos</a>
    <a href="/sistema/agenda?visao=lista" class="${ativa === "compromissos" ? "ativa" : ""}">Compromissos</a>
  </nav>`;

// Compromissos de sessão de julgamento têm data fixada pelo tribunal: não podem ser reagendados.
export const dataTravada = (p) => p?.categoria === "Compromisso" && /sess[aã]o\s+de\s+julgamento/i.test(`${p.tipo || ""} ${p.titulo || ""}`);

// ---------- Documentos, telefones e endereço ----------
export const soDigitos = (v) => String(v || "").replace(/\D/g, "");
export function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dig = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}
export function cnpjValido(v) {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dig = (n) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dig(12) === Number(d[12]) && dig(13) === Number(d[13]);
}
export const formatarCpf = (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
export const formatarCnpj = (d) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
export const formatarFone = (d) => (d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`);
export const formatarCep = (d) => `${d.slice(0, 5)}-${d.slice(5)}`;
// Endereço em uma linha, para exibição.
export const enderecoTexto = (e = {}) => [[e.rua, e.numero].filter(Boolean).join(", "), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join(" / "), e.cep && `CEP ${e.cep}`].filter(Boolean).join(" · ");
