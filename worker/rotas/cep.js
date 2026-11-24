// Consulta de CEP (ViaCEP), feita pelo servidor: a página só conversa com o próprio sistema.
export async function consultarCep(env, cep) {
  const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=86400" } });
  const d = String(cep || "").replace(/\D/g, "");
  if (d.length !== 8) return json({ ok: false, mensagem: "CEP deve ter 8 dígitos." }, 400);
  try {
    const r = await fetch(`${env.CEP_API || "https://viacep.com.br/ws"}/${d}/json/`, { headers: { Accept: "application/json" }, cf: { cacheTtl: 86400 } });
    if (!r.ok) return json({ ok: false, mensagem: "Serviço de CEP indisponível. Preencha manualmente." }, 502);
    const j = await r.json();
    if (j.erro) return json({ ok: false, mensagem: "CEP não encontrado. Confira o número ou preencha manualmente." });
    return json({ ok: true, rua: j.logradouro || "", complemento: j.complemento || "", bairro: j.bairro || "", cidade: j.localidade || "", uf: j.uf || "" });
  } catch {
    return json({ ok: false, mensagem: "Não foi possível consultar o CEP agora. Preencha manualmente." }, 502);
  }
}
