// Cadastro pessoal do usuário: "Editar cadastro" (o próprio usuário) e ficha do usuário (administradores).
import { html, pagina, resposta, campoCsrf } from "../html.js";
import { agora, cifrar, decifrar, conferirSenha } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt, dataValida, cpfValido, soDigitos, formatarCpf } from "./comum.js";
import { obterLista } from "../listas.js";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export const PERFIS = { admin: "Administrador", advogado: "Advogado", colaborador: "Colaborador" };
const ENC = ["celular", "telefone", "cpf", "nascimento"];
const END = ["rua", "numero", "complemento", "bairro", "cidade", "uf", "cep"];
const fmt = {
  celular: (d) => `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`,
  telefone: (d) => `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`,
  cep: (d) => `${d.slice(0, 5)}-${d.slice(5)}`,
};
const ufOpcoes = (atual) => html`<option value="">—</option>${UFS.map((x) => html`<option value="${x}"${x === atual ? html` selected` : ""}>${x}</option>`)}`;

// Lê o cadastro (campos cifrados decifrados) de um usuário.
export async function lerCadastro(env, u) {
  const dec = await Promise.all(ENC.map((k) => decifrar(env, u[`${k}_enc`])));
  const v = { ...u }; ENC.forEach((k, i) => (v[k] = dec[i]));
  try { Object.assign(v, JSON.parse((await decifrar(env, u.endereco_enc)) || "{}")); } catch { /* sem endereço */ }
  return v;
}

// Campos do formulário; com admin = true inclui perfil e acesso ao Financeiro.
export function camposCadastro(v, { admin = false, proprio = true, cargos = [] } = {}) {
  return html`
    <fieldset class="largo grade-form grupo-form"><legend>Dados pessoais</legend>
      <label class="duplo">Nome completo<input name="nome" required maxlength="120" value="${v.nome || ""}" autocomplete="${proprio ? "name" : "off"}"></label>
      <label>CPF<input name="cpf" maxlength="14" inputmode="numeric" data-mascara="cpf" value="${v.cpf || ""}" placeholder="000.000.000-00"></label>
      <label>Data de nascimento<input type="date" name="nascimento" value="${v.nascimento || ""}"></label>
    </fieldset>
    <fieldset class="largo grade-form grupo-form"><legend>Contato</legend>
      <label class="duplo">E-mail (usado para entrar)<input type="email" name="email" required maxlength="200" value="${v.email || ""}" autocomplete="${proprio ? "email" : "off"}"></label>
      <label>Celular / WhatsApp<input name="celular" maxlength="15" inputmode="tel" data-mascara="celular" value="${v.celular || ""}" placeholder="(XX) XXXXX-XXXX"></label>
      <label>Telefone fixo<input name="telefone" maxlength="14" inputmode="tel" data-mascara="telefone" value="${v.telefone || ""}" placeholder="(XX) XXXX-XXXX"></label>
    </fieldset>
    <fieldset class="largo grade-form grupo-form grupo-endereco"><legend>Endereço</legend>
      <label>CEP<input name="cep" data-endereco="cep" maxlength="9" inputmode="numeric" data-mascara="cep" value="${v.cep || ""}" placeholder="XXXXX-XXX"></label>
      <label class="duplo">Rua<input name="rua" data-endereco="rua" maxlength="150" value="${v.rua || ""}"></label>
      <label>Número<input name="numero" data-endereco="numero" maxlength="15" value="${v.numero || ""}"></label>
      <label>Complemento<input name="complemento" data-endereco="complemento" maxlength="80" value="${v.complemento || ""}" placeholder="Apto, sala, bloco"></label>
      <label>Bairro<input name="bairro" data-endereco="bairro" maxlength="80" value="${v.bairro || ""}"></label>
      <label>Cidade<input name="cidade" data-endereco="cidade" maxlength="80" value="${v.cidade || ""}"></label>
      <label>Estado<select name="uf" data-endereco="uf">${ufOpcoes(v.uf)}</select></label>
    </fieldset>
    <fieldset class="largo grade-form grupo-form"><legend>Dados profissionais</legend>
      <label class="duplo">Cargo / função<input name="cargo" maxlength="80" value="${v.cargo || ""}" list="l-cargos"></label>
      <label>OAB (número)<input name="oab_numero" maxlength="12" inputmode="numeric" value="${v.oab_numero || ""}"></label>
      <label>OAB (UF)<select name="oab_uf">${ufOpcoes(v.oab_uf)}</select></label>
      ${admin ? html`
        <label>Perfil de acesso<select name="perfil">${Object.entries(PERFIS).map(([k, r]) => html`<option value="${k}"${k === v.perfil ? html` selected` : ""}>${r}</option>`)}</select></label>
        <label class="opcao-linha"><input type="checkbox" name="acesso_financeiro" value="1"${v.acesso_financeiro ? html` checked` : ""}> Acesso ao Financeiro</label>
        <p class="dica largo">Administradores sempre têm acesso ao Financeiro e às Configurações.</p>`
      : html`<p class="dica largo">Perfil de acesso: <strong>${PERFIS[v.perfil] || v.perfil}</strong>${v.perfil === "admin" || v.acesso_financeiro ? " · com acesso ao Financeiro" : ""}. O perfil é alterado por um administrador.</p>`}
    </fieldset>
    <datalist id="l-cargos">${cargos.map((c) => html`<option value="${c}">`)}</datalist>`;
}

// Lê e valida o formulário. Devolve { v, erro }.
export function lerFormulario(f, { admin = false } = {}) {
  const v = {
    nome: txt(f, "nome", 120), email: (txt(f, "email", 200) || "").toLowerCase(), cargo: txt(f, "cargo", 80),
    oab_numero: soDigitos(txt(f, "oab_numero", 12)) || null, oab_uf: UFS.includes(f.get("oab_uf")) ? f.get("oab_uf") : null,
    celular: txt(f, "celular", 20), telefone: txt(f, "telefone", 20), cpf: txt(f, "cpf", 14), nascimento: dataValida(txt(f, "nascimento")),
    rua: txt(f, "rua", 150), numero: txt(f, "numero", 15), complemento: txt(f, "complemento", 80), bairro: txt(f, "bairro", 80),
    cidade: txt(f, "cidade", 80), uf: UFS.includes(f.get("uf")) ? f.get("uf") : null, cep: txt(f, "cep", 9),
  };
  if (admin) { v.perfil = PERFIS[f.get("perfil")] ? f.get("perfil") : "colaborador"; v.acesso_financeiro = f.get("acesso_financeiro") === "1" ? 1 : 0; }
  if (!v.nome) return { v, erro: "Informe o nome completo." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return { v, erro: "Informe um e-mail válido." };
  if (v.cpf) { if (!cpfValido(v.cpf)) return { v, erro: "CPF inválido." }; v.cpf = formatarCpf(soDigitos(v.cpf)); }
  if (v.nascimento && v.nascimento > new Date().toISOString().slice(0, 10)) return { v, erro: "Data de nascimento inválida." };
  for (const [campo, n, rotulo] of [["celular", 11, "Celular: use (XX) XXXXX-XXXX."], ["telefone", 10, "Telefone fixo: use (XX) XXXX-XXXX."], ["cep", 8, "CEP: use XXXXX-XXX."]]) {
    if (!v[campo]) continue;
    const d = soDigitos(v[campo]);
    if (d.length !== n) return { v, erro: rotulo };
    v[campo] = fmt[campo](d);
  }
  return { v, erro: null };
}

// Grava o cadastro do usuário id (e perfil/financeiro quando vierem do administrador).
export async function gravarCadastro(env, id, v) {
  const enc = await Promise.all(ENC.map((k) => cifrar(env, v[k])));
  const endereco = Object.fromEntries(END.filter((k) => v[k]).map((k) => [k, v[k]]));
  const endEnc = Object.keys(endereco).length ? await cifrar(env, JSON.stringify(endereco)) : null;
  await env.DB.prepare(`UPDATE usuarios SET nome = ?, email = ?, cargo = ?, oab_numero = ?, oab_uf = ?, celular_enc = ?, telefone_enc = ?, cpf_enc = ?,
      nascimento_enc = ?, endereco_enc = ?, atualizado_em = ? WHERE id = ?`)
    .bind(v.nome, v.email, v.cargo, v.oab_numero, v.oab_uf, ...enc, endEnc, agora(), id).run();
  if (v.perfil) await env.DB.prepare("UPDATE usuarios SET perfil = ?, acesso_financeiro = ? WHERE id = ?").bind(v.perfil, v.acesso_financeiro, id).run();
}

export const emailEmUso = async (env, email, id) => Boolean(await env.DB.prepare("SELECT id FROM usuarios WHERE email = ? AND id != ?").bind(email, id).first());
export const scriptsCadastro = html`<script src="/assets/js/mascaras.js" defer></script><script src="/assets/js/cep.js" defer></script>`;

// "Editar cadastro" do próprio usuário.
export async function editarCadastro(req, env, sessao) {
  const u = await env.DB.prepare("SELECT * FROM usuarios WHERE id = ?").bind(sessao.usuario_id).first();
  const cargos = await obterLista(env, "cargo");
  const tela = (v, { erro, aviso } = {}, status = 200) => resposta(pagina({
    titulo: "Editar cadastro", sessao, erro, aviso,
    corpo: html`<h1>Editar cadastro</h1>
      <section class="cartao">
        <form method="post" class="formulario grade-form form-cadastro">
          ${campoCsrf(sessao)}
          ${camposCadastro({ ...v, perfil: u.perfil, acesso_financeiro: u.acesso_financeiro }, { cargos })}
          <label class="duplo campo-senha-atual">Senha atual <small>(obrigatória só para trocar o e-mail)</small><input type="password" name="senha_atual" autocomplete="current-password"></label>
          <div class="largo botoes-form"><button type="submit">Salvar cadastro</button><a class="botao-link botao-secundario" href="/sistema/">Cancelar</a></div>
        </form>
        <p class="dica">CPF, data de nascimento, telefones e endereço são gravados cifrados.</p>
      </section>
      ${scriptsCadastro}`,
  }), status);

  if (req.method === "GET") return tela(await lerCadastro(env, u));
  const { f, ok } = await csrfOk(req, sessao);
  const { v, erro } = lerFormulario(f);
  if (!ok) return tela(v, { erro: "Sessão expirada. Tente novamente." }, 403);
  if (erro) return tela(v, { erro }, 400);
  const trocouEmail = v.email !== String(u.email).toLowerCase();
  if (trocouEmail) {
    if (!(await conferirSenha(String(f.get("senha_atual") || ""), u.senha_hash))) return tela(v, { erro: "Para trocar o e-mail, informe sua senha atual." }, 400);
    if (await emailEmUso(env, v.email, u.id)) return tela(v, { erro: "Já existe um usuário com esse e-mail." }, 400);
  }
  await gravarCadastro(env, u.id, v);
  await auditar(env, req, u.id, "cadastro_alterado", trocouEmail ? `e-mail: ${u.email} → ${v.email}` : "dados pessoais");
  sessao.nome = v.nome;
  return tela(v, { aviso: "Cadastro atualizado." });
}
