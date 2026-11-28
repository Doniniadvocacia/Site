// Busca para os campos de seleção de cliente e processo (por nome das partes, número do processo ou pasta).
import { criarFiltro } from "./dados.js";

export async function opcoesBusca(req, env) {
  const sp = new URL(req.url).searchParams;
  const tipo = ["processo", "pessoa"].includes(sp.get("tipo")) ? sp.get("tipo") : "cliente";
  const q = (sp.get("q") || "").trim().slice(0, 100);
  const clienteId = Number(sp.get("cliente")) || null;
  const json = (corpo) => new Response(JSON.stringify(corpo), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  const bate = criarFiltro(q);
  if (tipo === "pessoa") {
    if (q.length < 2) return json({ itens: [] });
    const { results } = await env.DB.prepare("SELECT id, nome, vinculo, cidade, estado FROM clientes ORDER BY nome COLLATE NOCASE").all();
    return json({ itens: results.filter((c) => bate(c.nome)).slice(0, 12)
      .map((c) => ({ id: c.id, titulo: c.nome, detalhe: [c.vinculo, [c.cidade, c.estado].filter(Boolean).join("/")].filter(Boolean).join(" · ") })) });
  }
  if (tipo === "cliente") {
    if (q.length < 2) return json({ itens: [] });
    const { results } = await env.DB.prepare(`SELECT c.id, c.nome, c.cidade, c.estado, GROUP_CONCAT(p.pasta, ' ') AS pastas, GROUP_CONCAT(p.numero, ' ') AS numeros,
        GROUP_CONCAT(p.parte_contraria, ' ') AS contrarias, COUNT(p.id) AS n
      FROM clientes c LEFT JOIN processos p ON p.cliente_id = c.id GROUP BY c.id ORDER BY c.nome COLLATE NOCASE`).all();
    const itens = results.filter((c) => bate(c.nome, c.pastas, c.numeros, c.contrarias)).slice(0, 12)
      .map((c) => ({ id: c.id, titulo: c.nome, detalhe: [`${c.n} processo(s)`, [c.cidade, c.estado].filter(Boolean).join("/")].filter(Boolean).join(" · ") }));
    return json({ itens });
  }
  // Processos: com cliente escolhido, lista os dele (mesmo sem digitar); sem cliente, busca a partir de 2 caracteres.
  if (!clienteId && q.length < 2) return json({ itens: [] });
  const { results } = await env.DB.prepare(`SELECT p.id, p.pasta, p.numero, p.parte_contraria, p.tipo_acao, p.cliente_id, c.nome AS cliente
    FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id ${clienteId ? "WHERE p.cliente_id = ?" : ""}
    ORDER BY CAST(p.pasta AS INTEGER), p.pasta`).bind(...(clienteId ? [clienteId] : [])).all();
  const itens = results.filter((p) => !q || bate(p.pasta, p.numero, p.cliente, p.parte_contraria)).slice(0, 15).map((p) => ({
    id: p.id, titulo: [p.pasta && `Pasta ${p.pasta}`, p.numero].filter(Boolean).join(" · ") || "Processo sem número",
    detalhe: [p.cliente, p.parte_contraria].filter(Boolean).join(" × ") + (p.tipo_acao ? ` · ${p.tipo_acao}` : ""),
    cliente_id: p.cliente_id, cliente_nome: p.cliente || "",
  }));
  return json({ itens });
}
