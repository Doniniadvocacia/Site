// Gestão de usuários (somente administradores).
import { html, pagina, resposta, campoCsrf, dataBR } from "../html.js";
import { agora, hashSenha, tokenAleatorio, iguais } from "../seguranca.js";
import { encerrarTodas, auditar } from "../sessao.js";
import { camposCadastro, lerCadastro, lerFormulario, gravarCadastro, emailEmUso, scriptsCadastro } from "./conta.js";

const PERFIS = { admin: "Administrador", advogado: "Advogado", colaborador: "Colaborador" };
const situacaoUsuario = (u) => (u.ativo ? (u.bloqueado_ate > agora() ? "Bloqueado" : "Ativo") : "Suspenso");
const senhaProvisoria = () => tokenAleatorio(12).replace(/[-_]/g, "x") + "7a";
const dataHora = (t) => (t ? new Date(t * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

async function tela(env, sessao, { erro, aviso, senhaGerada } = {}) {
  const { results } = await env.DB.prepare(
    "SELECT id, nome, email, perfil, ativo, totp_ativo, bloqueado_ate, ultimo_acesso, acesso_financeiro FROM usuarios WHERE perfil != 'cliente' ORDER BY nome"
  ).all();
  const linhas = results.map((u) => html`<tr class="${u.ativo ? "" : "inativo"}">
    <td><a href="/sistema/usuarios/${String(u.id)}">${u.nome}</a><br><small>${u.email}</small></td>
    <td>${PERFIS[u.perfil] || u.perfil}</td>
    <td>${u.perfil === "admin" ? "Sim (admin)" : u.acesso_financeiro ? "Sim" : "Não"}</td>
    <td>${u.totp_ativo ? "Ativo" : "Pendente"}</td>
    <td>${situacaoUsuario(u)}</td>
    <td>${dataHora(u.ultimo_acesso)}</td>
    <td class="acoes"><a class="botao-link botao-pequeno botao-secundario" href="/sistema/usuarios/${String(u.id)}">Abrir</a> ${u.id === sessao.usuario_id ? html`<small>você</small>` : html`
      <form method="post" action="/sistema/usuarios/${String(u.id)}">${campoCsrf(sessao)}
        <select name="acao" aria-label="Ação para ${u.nome}">
          <option value="">Ação…</option>
          <option value="senha">Gerar nova senha provisória</option>
          <option value="2fa">Refazer cadastro do 2FA</option>
          <option value="desbloquear">Desbloquear</option>
          ${u.perfil === "admin" ? "" : html`<option value="${u.acesso_financeiro ? "financeiro_revogar" : "financeiro_conceder"}">${u.acesso_financeiro ? "Revogar acesso ao Financeiro" : "Conceder acesso ao Financeiro"}</option>`}
          <option value="${u.ativo ? "desativar" : "ativar"}">${u.ativo ? "Suspender" : "Reativar"}</option>
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

// Ficha do usuário (administradores): consulta e edição dos dados, ações de acesso, suspensão e exclusão.
async function ficha(req, env, sessao, alvo, { erro, aviso, senhaGerada, valores } = {}, status = 200) {
  const v = valores || (await lerCadastro(env, alvo));
  const proprio = alvo.id === sessao.usuario_id;
  const t = (x) => (x ? new Date(x * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
  const acao = (valor, rotulo, classe = "botao-secundario") => html`<form method="post" class="form-linha">${campoCsrf(sessao)}<button type="submit" name="acao" value="${valor}" class="botao-pequeno ${classe}">${rotulo}</button></form>`;
  return resposta(pagina({
    titulo: alvo.nome, sessao, erro, aviso,
    corpo: html`<p class="trilha"><a href="/sistema/usuarios">Usuários</a></p>
      <div class="titulo-acoes"><div><h1>${alvo.nome}</h1>
        <p class="subtitulo">${PERFIS[alvo.perfil] || alvo.perfil} · <span class="selo ${alvo.ativo ? "selo-pago" : "selo-vencido"}">${situacaoUsuario(alvo)}</span> · 2FA ${alvo.totp_ativo ? "ativo" : "pendente"} · último acesso ${t(alvo.ultimo_acesso)}</p></div></div>
      ${senhaGerada ? html`<div class="caixa-senha"><p><strong>Senha provisória:</strong> <code class="chave">${senhaGerada}</code></p>
        <p class="dica">Ela aparece só agora. Entregue à pessoa por um canal seguro; no próximo acesso ela define a própria senha.</p></div>` : ""}
      ${proprio ? "" : html`<section class="cartao acoes-usuario"><h2>Acesso</h2><div class="botoes-form">
        ${acao("senha", "Gerar nova senha provisória")}${acao("2fa", "Refazer cadastro do 2FA")}
        ${alvo.bloqueado_ate > agora() ? acao("desbloquear", "Desbloquear") : ""}
        ${alvo.ativo ? acao("desativar", "Suspender usuário", "botao-alerta") : acao("ativar", "Reativar usuário")}
      </div><p class="dica">Suspender impede o acesso e encerra as sessões abertas, mantendo o cadastro e o histórico. Pode ser desfeito a qualquer momento.</p></section>`}
      <section class="cartao"><h2>Cadastro</h2>
        <form method="post" class="formulario grade-form form-cadastro">${campoCsrf(sessao)}
          ${camposCadastro(v, { admin: !proprio, proprio: false })}
          <div class="largo botoes-form"><button type="submit" name="acao" value="salvar">Salvar alterações</button><a class="botao-link botao-secundario" href="/sistema/usuarios">Voltar</a></div>
        </form>
        <p class="dica">CPF, data de nascimento, telefones e endereço são gravados cifrados.${proprio ? " Para alterar o próprio perfil de acesso, peça a outro administrador." : ""}</p>
      </section>
      ${proprio ? "" : html`<section class="cartao zona-perigo"><h2>Excluir usuário</h2>
        <p>Remove o acesso e o cadastro de forma definitiva. Prazos, andamentos e lançamentos criados por ele continuam no sistema, sem o nome do autor; o histórico de ações é mantido. Se a intenção é só impedir o acesso, prefira <strong>Suspender</strong>.</p>
        <form method="post" class="formulario form-excluir-usuario">${campoCsrf(sessao)}
          <label class="opcao-linha"><input type="checkbox" name="confirmar" value="1" required> Confirmo a exclusão definitiva de ${alvo.nome}</label>
          <div class="botoes-form"><button type="submit" name="acao" value="excluir" class="botao-alerta">Excluir usuário</button></div>
        </form></section>`}
      ${scriptsCadastro}`,
  }), status);
}

export async function usuarios(req, env, sessao, id) {
  if (req.method === "GET" && id) {
    const alvo = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil != 'cliente'").bind(Number(id)).first();
    if (!alvo) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Usuário não encontrado</h1>` }), 404);
    await auditar(env, req, sessao.usuario_id, "usuario_visualizado", alvo.email);
    return ficha(req, env, sessao, alvo, new URL(req.url).searchParams.get("salvo") ? { aviso: "Alterações salvas." } : {});
  }
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

  const alvo = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil != 'cliente'").bind(Number(id)).first();
  if (!alvo) return tela(env, sessao, { erro: "Usuário não encontrado." });
  const acao = String(f.get("acao") || "");
  const daFicha = (req.headers.get("Referer") || "").includes(`/sistema/usuarios/${alvo.id}`);
  const responder = async (opts) => (daFicha
    ? ficha(req, env, sessao, await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(alvo.id).first(), opts)
    : tela(env, sessao, opts));

  if (acao === "salvar") {
    const proprio = alvo.id === sessao.usuario_id;
    const { v, erro } = lerFormulario(f, { admin: !proprio });
    if (erro) return ficha(req, env, sessao, alvo, { erro, valores: { ...alvo, ...v } }, 400);
    if (await emailEmUso(env, v.email, alvo.id)) return ficha(req, env, sessao, alvo, { erro: "Já existe um usuário com esse e-mail.", valores: { ...alvo, ...v } }, 400);
    if (!proprio && alvo.perfil === "admin" && v.perfil !== "admin") {
      const admins = (await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo = 1").first()).n;
      if (admins <= 1) return ficha(req, env, sessao, alvo, { erro: "Este é o único administrador ativo; o perfil não pode ser rebaixado.", valores: { ...alvo, ...v } }, 400);
    }
    await gravarCadastro(env, alvo.id, v);
    if (v.perfil && v.perfil !== alvo.perfil) await encerrarTodas(env, alvo.id);
    await auditar(env, req, sessao.usuario_id, "usuario_alterado", `${alvo.email}${v.email !== alvo.email ? ` → ${v.email}` : ""}${v.perfil && v.perfil !== alvo.perfil ? ` · perfil ${alvo.perfil} → ${v.perfil}` : ""}`);
    if (proprio) sessao.nome = v.nome;
    return ficha(req, env, sessao, await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(alvo.id).first(), { aviso: "Alterações salvas." });
  }
  if (alvo.id === sessao.usuario_id) return responder({ erro: "Essa ação não pode ser aplicada ao próprio usuário." });

  if (acao === "excluir") {
    if (f.get("confirmar") !== "1") return responder({ erro: "Marque a confirmação para excluir." });
    if (alvo.perfil === "admin") {
      const admins = (await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id != ?").bind(alvo.id).first()).n;
      if (!admins) return responder({ erro: "Não é possível excluir o único administrador ativo." });
    }
    // Mantém os registros criados pelo usuário, sem o vínculo com o autor.
    await env.DB.batch([
      ...[["prazos", "criado_por"], ["agenda", "criado_por"], ["historico", "criado_por"], ["financeiro", "criado_por"], ["anexos", "criado_por"],
        ["publicacoes", "triada_por"], ["configuracoes", "atualizado_por"]].map(([tab, col]) => env.DB.prepare(`UPDATE ${tab} SET ${col} = NULL WHERE ${col} = ?`).bind(alvo.id)),
      env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(alvo.id),
      env.DB.prepare("DELETE FROM usuarios WHERE id = ?").bind(alvo.id),
    ]);
    await auditar(env, req, sessao.usuario_id, "usuario_excluido", `${alvo.nome} <${alvo.email}> (id ${alvo.id})`);
    return tela(env, sessao, { aviso: `Usuário ${alvo.nome} excluído.` });
  }
  if (acao === "senha") {
    const senha = senhaProvisoria();
    await env.DB.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, falhas = 0, bloqueado_ate = 0 WHERE id = ?").bind(await hashSenha(senha), alvo.id).run();
    await encerrarTodas(env, alvo.id);
    await auditar(env, req, sessao.usuario_id, "senha_redefinida", alvo.email);
    return responder({ aviso: `Nova senha provisória gerada para ${alvo.nome}.`, senhaGerada: senha });
  }
  const comandos = {
    "2fa": ["UPDATE usuarios SET totp_enc = NULL, totp_ativo = 0, totp_ultimo = 0 WHERE id = ?", "2FA reiniciado: será cadastrado de novo no próximo acesso."],
    desbloquear: ["UPDATE usuarios SET falhas = 0, bloqueado_ate = 0 WHERE id = ?", "Usuário desbloqueado."],
    desativar: ["UPDATE usuarios SET ativo = 0 WHERE id = ?", "usuário suspenso (não consegue entrar até ser reativado)."],
    ativar: ["UPDATE usuarios SET ativo = 1, falhas = 0, bloqueado_ate = 0 WHERE id = ?", "usuário reativado."],
    financeiro_conceder: ["UPDATE usuarios SET acesso_financeiro = 1 WHERE id = ?", "acesso ao Financeiro concedido."],
    financeiro_revogar: ["UPDATE usuarios SET acesso_financeiro = 0 WHERE id = ?", "acesso ao Financeiro revogado."],
  };
  if (!comandos[acao]) return responder({ erro: "Escolha uma ação." });
  await env.DB.prepare(comandos[acao][0]).bind(alvo.id).run();
  if (acao === "2fa" || acao === "desativar") await encerrarTodas(env, alvo.id);
  await auditar(env, req, sessao.usuario_id, `usuario_${acao}`, alvo.email);
  return responder({ aviso: `${alvo.nome}: ${comandos[acao][1]}` });
}
