// Configuração inicial, login, 2FA, troca de senha e saída.
import qrcode from "qrcode-generator";
import { html, pagina, resposta, redirecionar, campoCsrf, seguro } from "../html.js";
import { agora, hashSenha, conferirSenha, validarSenha, cifrar, decifrar, novoSegredoTotp, conferirTotp, uriTotp, iguais } from "../seguranca.js";
import { criarSessao, encerrarSessao, encerrarTodas, cookieApagar, auditar } from "../sessao.js";

const MAX_FALHAS = 5;
const BLOQUEIO = 15 * 60;
// Hash de uma senha qualquer, usado quando o e-mail não existe, para o tempo de resposta ser o mesmo.
const HASH_FICTICIO = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function haUsuarios(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
  return r.n > 0;
}

// ---------- Configuração inicial (só funciona enquanto não houver nenhum usuário) ----------
function telaConfigurar(erro) {
  return pagina({
    titulo: "Configuração inicial",
    erro,
    corpo: html`<section class="cartao estreito">
      <h1>Configuração inicial</h1>
      <p>Crie a conta do administrador. Esta tela só funciona uma vez, enquanto o sistema não tiver nenhum usuário.</p>
      <form method="post" class="formulario">
        <label>Código de configuração<input name="token" type="password" required autocomplete="off"></label>
        <label>Nome<input name="nome" required maxlength="120"></label>
        <label>E-mail<input name="email" type="email" required maxlength="200" autocomplete="username"></label>
        <label>Senha<input name="senha" type="password" required minlength="12" autocomplete="new-password"></label>
        <label>Confirme a senha<input name="senha2" type="password" required minlength="12" autocomplete="new-password"></label>
        <p class="dica">Mínimo de 12 caracteres, com letras e números.</p>
        <button type="submit">Criar administrador</button>
      </form>
    </section>`,
  });
}

export async function configurar(req, env) {
  if (await haUsuarios(env)) return redirecionar("/sistema/entrar");
  if (req.method === "GET") return resposta(telaConfigurar());
  const f = await req.formData();
  if (!env.SETUP_TOKEN || !iguais(String(f.get("token") || ""), env.SETUP_TOKEN)) {
    await auditar(env, req, null, "configuracao_negada");
    return resposta(telaConfigurar("Código de configuração inválido."), 403);
  }
  const nome = String(f.get("nome") || "").trim();
  const email = String(f.get("email") || "").trim().toLowerCase();
  const senha = String(f.get("senha") || "");
  if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resposta(telaConfigurar("Preencha nome e e-mail válidos."), 400);
  if (senha !== f.get("senha2")) return resposta(telaConfigurar("As senhas não conferem."), 400);
  const problema = validarSenha(senha);
  if (problema) return resposta(telaConfigurar(problema), 400);
  if (await haUsuarios(env)) return redirecionar("/sistema/entrar");
  const r = await env.DB.prepare(
    "INSERT INTO usuarios (nome, email, senha_hash, perfil, trocar_senha, criado_em) VALUES (?, ?, ?, 'admin', 0, ?)"
  ).bind(nome, email, await hashSenha(senha), agora()).run();
  const id = r.meta.last_row_id;
  await auditar(env, req, id, "administrador_criado", email);
  const cookie = await criarSessao(env, req, id, "senha");
  return redirecionar("/sistema/2fa", { "Set-Cookie": cookie });
}

// ---------- Login: e-mail e senha ----------
function telaEntrar(erro, email = "") {
  return pagina({
    titulo: "Entrar",
    erro,
    corpo: html`<section class="cartao estreito">
      <h1>Entrar no sistema</h1>
      <form method="post" action="/sistema/entrar" class="formulario">
        <label>E-mail<input name="email" type="email" required value="${email}" autocomplete="username" autofocus></label>
        <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
        <button type="submit">Continuar</button>
      </form>
      <p class="dica">Em seguida será pedido o código do aplicativo autenticador.</p>
    </section>`,
  });
}

export async function entrar(req, env, sessao) {
  if (!(await haUsuarios(env))) return redirecionar("/sistema/configurar");
  if (sessao?.etapa === "completa") return redirecionar("/sistema/");
  if (req.method === "GET") return resposta(telaEntrar());

  const f = await req.formData();
  const email = String(f.get("email") || "").trim().toLowerCase();
  const senha = String(f.get("senha") || "");
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE email = ?").bind(email).first();
  const t = agora();
  const ERRO = "E-mail ou senha incorretos.";

  if (!u) {
    await conferirSenha(senha, HASH_FICTICIO);
    await auditar(env, req, null, "login_falhou", `e-mail desconhecido: ${email}`);
    return resposta(telaEntrar(ERRO, email), 401);
  }
  if (u.bloqueado_ate > t) {
    await auditar(env, req, u.id, "login_bloqueado");
    return resposta(telaEntrar("Acesso bloqueado temporariamente por excesso de tentativas. Tente de novo em alguns minutos.", email), 429);
  }
  if (!u.ativo || !(await conferirSenha(senha, u.senha_hash))) {
    const falhas = u.falhas + 1;
    const bloqueio = falhas >= MAX_FALHAS ? t + BLOQUEIO : 0;
    await env.DB.prepare("UPDATE usuarios SET falhas = ?, bloqueado_ate = ? WHERE id = ?").bind(bloqueio ? 0 : falhas, bloqueio, u.id).run();
    await auditar(env, req, u.id, bloqueio ? "login_bloqueou" : "login_falhou");
    return resposta(telaEntrar(ERRO, email), 401);
  }
  await auditar(env, req, u.id, "senha_correta");
  if (sessao) await encerrarSessao(env, sessao);
  const cookie = await criarSessao(env, req, u.id, "senha");
  return redirecionar("/sistema/2fa", { "Set-Cookie": cookie });
}

// ---------- Segundo fator ----------
function svgQr(uri) {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

export async function doisFatores(req, env, sessao) {
  if (!sessao) return redirecionar("/sistema/entrar");
  if (sessao.etapa === "completa") return redirecionar("/sistema/");

  // Primeiro acesso: gera o segredo (ainda inativo) para o usuário cadastrar no aplicativo.
  let segredo = sessao.totp_enc ? await decifrar(env, sessao.totp_enc) : null;
  if (!sessao.totp_ativo && !segredo) {
    segredo = novoSegredoTotp();
    await env.DB.prepare("UPDATE usuarios SET totp_enc = ? WHERE id = ?").bind(await cifrar(env, segredo), sessao.usuario_id).run();
  }

  const tela = (erro) => {
    const cadastro = !sessao.totp_ativo;
    return pagina({
      titulo: "Verificação em duas etapas",
      erro,
      corpo: html`<section class="cartao estreito">
        <h1>Verificação em duas etapas</h1>
        ${cadastro ? html`
          <p>Este é o seu primeiro acesso. Abra o Google Authenticator ou o Microsoft Authenticator no celular, toque em adicionar conta e leia o código abaixo.</p>
          <div class="qr">${seguro(svgQr(uriTotp(segredo, sessao.email)))}</div>
          <p class="dica">Sem câmera? Digite esta chave no aplicativo:<br><code class="chave">${segredo.match(/.{1,4}/g).join(" ")}</code></p>
          <p>Depois, digite o código de 6 dígitos que aparece no aplicativo.</p>`
        : html`<p>Digite o código de 6 dígitos do seu aplicativo autenticador.</p>`}
        <form method="post" class="formulario">
          ${campoCsrf(sessao)}
          <label>Código<input name="codigo" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" required autocomplete="one-time-code" autofocus></label>
          <button type="submit">${cadastro ? "Ativar e entrar" : "Entrar"}</button>
        </form>
      </section>`,
    });
  };

  if (req.method === "GET") return resposta(tela());

  const f = await req.formData();
  if (!iguais(String(f.get("csrf") || ""), sessao.csrf)) return resposta(tela("Sessão expirada. Tente novamente."), 403);

  const u = await env.DB.prepare("SELECT falhas, bloqueado_ate FROM usuarios WHERE id = ?").bind(sessao.usuario_id).first();
  const t = agora();
  if (u.bloqueado_ate > t) {
    await encerrarSessao(env, sessao);
    return redirecionar("/sistema/entrar", { "Set-Cookie": cookieApagar() });
  }
  const passo = await conferirTotp(segredo, f.get("codigo"), sessao.totp_ultimo);
  if (!passo) {
    const falhas = u.falhas + 1;
    const bloqueio = falhas >= MAX_FALHAS ? t + BLOQUEIO : 0;
    await env.DB.prepare("UPDATE usuarios SET falhas = ?, bloqueado_ate = ? WHERE id = ?").bind(bloqueio ? 0 : falhas, bloqueio, sessao.usuario_id).run();
    await auditar(env, req, sessao.usuario_id, bloqueio ? "2fa_bloqueou" : "2fa_falhou");
    if (bloqueio) {
      await encerrarSessao(env, sessao);
      return redirecionar("/sistema/entrar", { "Set-Cookie": cookieApagar() });
    }
    return resposta(tela("Código inválido. Confira o horário do celular e tente de novo."), 401);
  }
  await env.DB.prepare("UPDATE usuarios SET totp_ativo = 1, totp_ultimo = ?, falhas = 0, bloqueado_ate = 0, ultimo_acesso = ? WHERE id = ?")
    .bind(passo, t, sessao.usuario_id).run();
  await auditar(env, req, sessao.usuario_id, sessao.totp_ativo ? "login_ok" : "2fa_ativado");
  // Troca de sessão ao concluir o login (evita fixação de sessão).
  await encerrarSessao(env, sessao);
  const cookie = await criarSessao(env, req, sessao.usuario_id, "completa");
  return redirecionar(sessao.trocar_senha ? "/sistema/conta/senha" : "/sistema/", { "Set-Cookie": cookie });
}

// ---------- Sair ----------
export async function sair(req, env, sessao) {
  if (sessao) {
    const f = await req.formData();
    if (iguais(String(f.get("csrf") || ""), sessao.csrf)) {
      await auditar(env, req, sessao.usuario_id, "logout");
      await encerrarSessao(env, sessao);
    }
  }
  return redirecionar("/sistema/entrar", { "Set-Cookie": cookieApagar() });
}

// ---------- Troca de senha ----------
export async function trocarSenha(req, env, sessao) {
  const obrigatoria = !!sessao.trocar_senha;
  const tela = (erro, aviso) => pagina({
    titulo: "Minha senha",
    sessao: obrigatoria ? null : sessao,
    erro, aviso,
    corpo: html`<section class="cartao estreito">
      <h1>${obrigatoria ? "Defina sua senha" : "Alterar senha"}</h1>
      ${obrigatoria ? html`<p>Você entrou com uma senha provisória. Escolha uma senha pessoal para continuar.</p>` : ""}
      <form method="post" class="formulario">
        ${campoCsrf(sessao)}
        <label>Senha atual<input name="atual" type="password" required autocomplete="current-password"></label>
        <label>Nova senha<input name="nova" type="password" required minlength="12" autocomplete="new-password"></label>
        <label>Confirme a nova senha<input name="nova2" type="password" required minlength="12" autocomplete="new-password"></label>
        <p class="dica">Mínimo de 12 caracteres, com letras e números. Ao trocar, as outras sessões abertas são encerradas.</p>
        <button type="submit">Salvar senha</button>
      </form>
    </section>`,
  });
  if (req.method === "GET") return resposta(tela());
  const f = await req.formData();
  if (!iguais(String(f.get("csrf") || ""), sessao.csrf)) return resposta(tela("Sessão expirada. Tente novamente."), 403);
  const u = await env.DB.prepare("SELECT senha_hash FROM usuarios WHERE id = ?").bind(sessao.usuario_id).first();
  if (!(await conferirSenha(String(f.get("atual") || ""), u.senha_hash))) return resposta(tela("Senha atual incorreta."), 400);
  const nova = String(f.get("nova") || "");
  if (nova !== f.get("nova2")) return resposta(tela("As senhas não conferem."), 400);
  const problema = validarSenha(nova);
  if (problema) return resposta(tela(problema), 400);
  await env.DB.prepare("UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?").bind(await hashSenha(nova), sessao.usuario_id).run();
  await encerrarTodas(env, sessao.usuario_id, sessao.token_hash);
  await auditar(env, req, sessao.usuario_id, "senha_alterada");
  if (obrigatoria) return redirecionar("/sistema/");
  sessao.trocar_senha = 0;
  return resposta(tela(null, "Senha alterada."));
}
