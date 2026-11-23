// Gestão de usuários (somente administradores).
import { html, pagina, resposta, campoCsrf, dataBR } from "../html.js";
import { agora, hashSenha, tokenAleatorio, iguais } from "../seguranca.js";
import { encerrarTodas, auditar } from "../sessao.js";

const PERFIS = { admin: "Administrador", advogado: "Advogado", colaborador: "Colaborador" };
const senhaProvisoria = () => tokenAleatorio(12).replace(/[-_]/g, "x") + "7a";
const dataHora = (t) => (t ? new Date(t * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

async function tela(env, sessao, { erro, aviso, senhaGerada } = {}) {
  const { results } = await env.DB.prepare(
    "SELECT id, nome, email, perfil, ativo, totp_ativo, bloqueado_ate, ultimo_acesso, acesso_financeiro FROM usuarios WHERE perfil != 'cliente' ORDER BY nome"
  ).all();
  const linhas = results.map((u) => html`<tr class="${u.ativo ? "" : "inativo"}">
    <td>${u.nome}<br><small>${u.email}</small></td>
    <td>${PERFIS[u.perfil] || u.perfil}</td>
    <td>${u.perfil === "admin" ? "Sim (admin)" : u.acesso_financeiro ? "Sim" : "Não"}</td>
    <td>${u.totp_ativo ? "Ativo" : "Pendente"}</td>
    <td>${u.ativo ? (u.bloqueado_ate > agora() ? "Bloqueado" : "Ativo") : "Desativado"}</td>
    <td>${dataHora(u.ultimo_acesso)}</td>
    <td class="acoes">${u.id === sessao.usuario_id ? html`<small>você</small>` : html`
      <form method="post" action="/sistema/usuarios/${String(u.id)}">${campoCsrf(sessao)}
        <select name="acao" aria-label="Ação para ${u.nome}">
          <option value="">Ação…</option>
          <option value="senha">Gerar nova senha provisória</option>
          <option value="2fa">Refazer cadastro do 2FA</option>
          <option value="desbloquear">Desbloquear</option>
          ${u.perfil === "admin" ? "" : html`<option value="${u.acesso_financeiro ? "financeiro_revogar" : "financeiro_conceder"}">${u.acesso_financeiro ? "Revogar acesso ao Financeiro" : "Conceder acesso ao Financeiro"}</option>`}
          <option value="${u.ativo ? "desativar" : "ativar"}">${u.ativo ? "Desativar" : "Reativar"}</option>
        </select>
        <button type="submit" class="botao-pequeno">Aplicar</button>
      </form>`}</td>
  </tr>`);
  return resposta(pagina({
    titulo: "Usuários", sessao, erro, aviso,
    corpo: html`
      <h1>Usuários</h1>
      ${senhaGerada ? html`<div class="caixa-senha">
        <p><strong>Senha provisória:</strong> <code class="chave">${senhaGerada}</code></p>
        <p class="dica">Ela aparece só agora. Entregue à pessoa por um canal seguro; no primeiro acesso ela define a própria senha e cadastra o 2FA.</p>
      </div>` : ""}
      <div class="tabela-rolagem"><table>
        <thead><tr><th>Nome</th><th>Perfil</th><th>Financeiro</th><th>2FA</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>
      <section class="cartao">
        <h2>Novo usuário</h2>
        <form method="post" action="/sistema/usuarios" class="formulario em-linha">
          ${campoCsrf(sessao)}
          <label>Nome<input name="nome" required maxlength="120"></label>
          <label>E-mail<input name="email" type="email" required maxlength="200"></label>
          <label>Perfil<select name="perfil">
            <option value="colaborador">Colaborador</option>
            <option value="advogado">Advogado</option>
            <option value="admin">Administrador</option>
          </select></label>
          <label class="opcao-linha"><input type="checkbox" name="financeiro" value="1"> Acesso ao Financeiro</label>
          <button type="submit">Criar usuário</button>
        </form>
      </section>`,
  }));
}

export async function usuarios(req, env, sessao, id) {
  if (req.method === "GET") return tela(env, sessao);
  const f = await req.formData();
  if (!iguais(String(f.get("csrf") || ""), sessao.csrf)) return tela(env, sessao, { erro: "Sessão expirada. Tente novamente." });

  if (!id) {
    const nome = String(f.get("nome") || "").trim();
    const email = String(f.get("email") || "").trim().toLowerCase();
    const perfil = String(f.get("perfil") || "colaborador");
    if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !PERFIS[perfil]) return tela(env, sessao, { erro: "Preencha nome, e-mail e perfil válidos." });
    const existe = await env.DB.prepare("SELECT id FROM usuarios WHERE email = ?").bind(email).first();
    if (existe) return tela(env, sessao, { erro: "Já existe um usuário com esse e-mail." });
    const senha = senhaProvisoria();
    const fin = f.get("financeiro") === "1" ? 1 : 0;
    await env.DB.prepare("INSERT INTO usuarios (nome, email, senha_hash, perfil, trocar_senha, criado_em, acesso_financeiro) VALUES (?, ?, ?, ?, 1, ?, ?)")
      .bind(nome, email, await hashSenha(senha), perfil, agora(), fin).run();
    await auditar(env, req, sessao.usuario_id, "usuario_criado", `${email} (${perfil}${fin ? ", financeiro" : ""})`);
    return tela(env, sessao, { aviso: `Usuário ${nome} criado.`, senhaGerada: senha });
  }

  const alvo = await env.DB.prepare("SELECT id, nome, email FROM usuarios WHERE id = ? AND perfil != 'cliente'").bind(Number(id)).first();
  if (!alvo || alvo.id === sessao.usuario_id) return tela(env, sessao, { erro: "Usuário não encontrado." });
  const acao = String(f.get("acao") || "");
  if (acao === "senha") {
    const senha = senhaProvisoria();
    await env.DB.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, falhas = 0, bloqueado_ate = 0 WHERE id = ?").bind(await hashSenha(senha), alvo.id).run();
    await encerrarTodas(env, alvo.id);
    await auditar(env, req, sessao.usuario_id, "senha_redefinida", alvo.email);
    return tela(env, sessao, { aviso: `Nova senha provisória gerada para ${alvo.nome}.`, senhaGerada: senha });
  }
  const comandos = {
    "2fa": ["UPDATE usuarios SET totp_enc = NULL, totp_ativo = 0, totp_ultimo = 0 WHERE id = ?", "2FA reiniciado: será cadastrado de novo no próximo acesso."],
    desbloquear: ["UPDATE usuarios SET falhas = 0, bloqueado_ate = 0 WHERE id = ?", "Usuário desbloqueado."],
    desativar: ["UPDATE usuarios SET ativo = 0 WHERE id = ?", "Usuário desativado."],
    ativar: ["UPDATE usuarios SET ativo = 1 WHERE id = ?", "Usuário reativado."],
    financeiro_conceder: ["UPDATE usuarios SET acesso_financeiro = 1 WHERE id = ?", "acesso ao Financeiro concedido."],
    financeiro_revogar: ["UPDATE usuarios SET acesso_financeiro = 0 WHERE id = ?", "acesso ao Financeiro revogado."],
  };
  if (!comandos[acao]) return tela(env, sessao, { erro: "Escolha uma ação." });
  await env.DB.prepare(comandos[acao][0]).bind(alvo.id).run();
  if (acao === "2fa" || acao === "desativar") await encerrarTodas(env, alvo.id);
  await auditar(env, req, sessao.usuario_id, `usuario_${acao}`, alvo.email);
  return tela(env, sessao, { aviso: `${alvo.nome}: ${comandos[acao][1]}` });
}
