// Telas da integração com o SharePoint: Configurações › Microsoft 365 (administradores) e a pasta do processo.
import { html, pagina, resposta, redirecionar, campoCsrf, dataBR } from "../html.js";
import { agora, tokenAleatorio, iguais } from "../seguranca.js";
import { auditar } from "../sessao.js";
import { csrfOk, txt } from "./comum.js";
import { lerConfig, gravarConfig } from "../asaas.js";
import { LIMITE_ANEXO } from "../anexos.js";
import {
  msConfigurado, urlAutorizacao, urlRetorno, concluirConexao, desconectar, lerAlvo, buscarSites, bibliotecas,
  listarPasta, lerItem, criarPasta, enviarArquivo,
} from "../microsoft.js";

const tamanho = (b) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);
const extensao = (n) => ((String(n).match(/\.([a-z0-9]{1,5})$/i) || [])[1] || "").toUpperCase();
const linkExterno = (url, texto, cls = "") => (/^https:\/\//.test(url || "") ? html`<a class="${cls}" href="${url}" target="_blank" rel="noopener noreferrer">${texto}</a>` : texto);

// ---------- Configurações › Microsoft 365 ----------
export async function configuracaoMicrosoft(req, env, sessao, sub) {
  if (sessao.perfil !== "admin") return resposta(pagina({ titulo: "Acesso negado", sessao, corpo: html`<h1>Acesso restrito a administradores</h1>` }), 403);
  const url = new URL(req.url);
  const volta = (msg, extra = "") => redirecionar(`/sistema/microsoft?msg=${msg}${extra}`);

  if (sub === "retorno") {
    const erroMs = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (erroMs) return volta("erro", `&m=${encodeURIComponent(erroMs.slice(0, 200))}`);
    const estado = JSON.parse((await lerConfig(env, "ms_estado")) || "{}");
    await gravarConfig(env, "ms_estado", null);
    if (!estado.v || !iguais(String(url.searchParams.get("state") || ""), estado.v) || estado.u !== sessao.usuario_id || estado.exp < agora()) return volta("estado");
    try { await concluirConexao(env, req, String(url.searchParams.get("code") || ""), sessao.usuario_id); }
    catch (e) { return volta("erro", `&m=${encodeURIComponent(e.message.slice(0, 200))}`); }
    await auditar(env, req, sessao.usuario_id, "microsoft_conectado", "");
    return volta("conectado");
  }

  // Início do login: é um link (GET), porque a política de segurança da página não deixa um formulário redirecionar para outro site.
  // A proteção contra uso indevido é o "state" aleatório, conferido no retorno.
  if (sub === "conectar") {
    if (!msConfigurado(env)) return volta("sem_app");
    const v = tokenAleatorio(24);
    await gravarConfig(env, "ms_estado", JSON.stringify({ v, u: sessao.usuario_id, exp: agora() + 600 }));
    return redirecionar(urlAutorizacao(env, req, v));
  }

  if (req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return volta("sessao");
    const acao = f.get("acao");
    try {
      if (acao === "desconectar") { await desconectar(env, sessao.usuario_id); await auditar(env, req, sessao.usuario_id, "microsoft_desconectado", ""); return volta("desconectado"); }
      if (acao === "site") { await gravarConfig(env, "ms_site", JSON.stringify({ id: txt(f, "id", 300), nome: txt(f, "nome", 200), url: txt(f, "url", 500) }), sessao.usuario_id); await gravarConfig(env, "ms_drive", null); await gravarConfig(env, "ms_base", null); return volta("site"); }
      if (acao === "biblioteca") { await gravarConfig(env, "ms_drive", JSON.stringify({ id: txt(f, "id", 300), nome: txt(f, "nome", 200) }), sessao.usuario_id); await gravarConfig(env, "ms_base", null); return volta("biblioteca"); }
      if (acao === "base") { await gravarConfig(env, "ms_base", JSON.stringify({ id: txt(f, "id", 300) || "root", nome: txt(f, "nome", 200) || "Raiz da biblioteca" }), sessao.usuario_id); await auditar(env, req, sessao.usuario_id, "microsoft_pasta_raiz", txt(f, "nome", 200) || ""); return volta("pronto"); }
      if (acao === "criar") {
        const alvo = await lerAlvo(env);
        const nova = await criarPasta(env, alvo.drive.id, txt(f, "pai", 300) || "root", txt(f, "nome", 200) || "Processos");
        return redirecionar(`/sistema/microsoft?pasta=${encodeURIComponent(nova.id)}`);
      }
      if (acao === "trocar") { for (const k of ["ms_site", "ms_drive", "ms_base"]) await gravarConfig(env, k, null, sessao.usuario_id); return volta("trocar"); }
    } catch (e) { return volta("erro", `&m=${encodeURIComponent(e.message.slice(0, 200))}`); }
    return volta("dados");
  }

  const alvo = msConfigurado(env) ? await lerAlvo(env) : { conta: null };
  const msg = url.searchParams.get("msg");
  const avisos = { conectado: "Conta Microsoft conectada. Agora escolha o site do SharePoint.", desconectado: "Microsoft 365 desconectado.", site: "Site escolhido. Agora escolha a biblioteca.",
    biblioteca: "Biblioteca escolhida. Agora escolha a pasta onde ficam as pastas dos processos.", pronto: "Pronto: a pasta raiz foi definida. Vincule as pastas na ficha de cada processo.", trocar: "Escolha novamente o site, a biblioteca e a pasta." };
  const erros = { sessao: "Sessão expirada. Tente novamente.", estado: "A conexão expirou ou não confere. Clique em Conectar de novo.", sem_app: "Faltam os segredos MS_CLIENT_ID e MS_CLIENT_SECRET na Cloudflare.",
    erro: `Microsoft: ${url.searchParams.get("m") || "erro"}`, dados: "Não foi possível concluir." };
  let etapa = html``;
  try {
    if (alvo.conta && !alvo.site) {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      const sites = q ? await buscarSites(env, q) : [];
      etapa = html`<section class="cartao"><h2>1. Site do SharePoint</h2>
        <form method="get" class="busca"><input name="q" value="${q}" placeholder="Nome do site ou endereço copiado do SharePoint" aria-label="Buscar site"><button type="submit">Buscar</button></form>
        ${q ? (sites.length ? html`<ul class="lista-ms">${sites.map((s) => html`<li><span><strong>${s.displayName || s.name}</strong><small>${s.webUrl || ""}</small></span>
          <form method="post">${campoCsrf(sessao)}<input type="hidden" name="acao" value="site"><input type="hidden" name="id" value="${s.id}"><input type="hidden" name="nome" value="${s.displayName || s.name}"><input type="hidden" name="url" value="${s.webUrl || ""}">
          <button type="submit" class="botao-pequeno">Escolher</button></form></li>`)}</ul>` : html`<p class="vazio">Nenhum site encontrado com esse nome.</p>`) : ""}</section>`;
    } else if (alvo.site && !alvo.drive) {
      const libs = await bibliotecas(env, alvo.site.id);
      etapa = html`<section class="cartao"><h2>2. Biblioteca de documentos</h2><p class="dica">Site: ${alvo.site.nome}</p>
        <ul class="lista-ms">${libs.map((d) => html`<li><span><strong>${d.name}</strong></span>
          <form method="post">${campoCsrf(sessao)}<input type="hidden" name="acao" value="biblioteca"><input type="hidden" name="id" value="${d.id}"><input type="hidden" name="nome" value="${d.name}">
          <button type="submit" class="botao-pequeno">Escolher</button></form></li>`)}</ul></section>`;
    } else if (alvo.drive && !alvo.pasta) {
      const atual = url.searchParams.get("pasta") || "root";
      const [item, filhos] = await Promise.all([lerItem(env, alvo.drive.id, atual), listarPasta(env, alvo.drive.id, atual)]);
      const pai = atual !== "root" ? item.parentReference?.id : null;
      etapa = html`<section class="cartao"><h2>3. Pasta raiz dos processos</h2>
        <p class="dica">Biblioteca: ${alvo.drive.nome} · pasta atual: <strong>${atual === "root" ? "raiz da biblioteca" : item.name}</strong>. Escolha a pasta onde ficam (ou ficarão) as pastas dos processos.</p>
        <div class="botoes-form">
          <form method="post">${campoCsrf(sessao)}<input type="hidden" name="acao" value="base"><input type="hidden" name="id" value="${atual}"><input type="hidden" name="nome" value="${atual === "root" ? "Raiz da biblioteca" : item.name}">
            <button type="submit">Usar esta pasta</button></form>
          ${pai ? html`<a class="botao-link botao-secundario" href="/sistema/microsoft?pasta=${encodeURIComponent(pai)}">Subir um nível</a>` : ""}
        </div>
        <ul class="lista-ms">${filhos.filter((x) => x.folder).map((x) => html`<li><span>📁 <a href="/sistema/microsoft?pasta=${encodeURIComponent(x.id)}">${x.name}</a></span></li>`)}</ul>
        <form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="acao" value="criar"><input type="hidden" name="pai" value="${atual}">
          <input name="nome" value="Processos" maxlength="200" aria-label="Nome da nova pasta"><button type="submit" class="botao-secundario botao-pequeno">Criar pasta aqui</button></form></section>`;
    }
  } catch (e) { etapa = html`<p class="erro">Microsoft: ${e.message}</p>`; }

  return resposta(pagina({
    titulo: "Microsoft 365", sessao, ...(avisos[msg] ? { aviso: avisos[msg] } : {}), ...(erros[msg] ? { erro: erros[msg] } : {}),
    corpo: html`<p class="trilha"><a href="/sistema/configuracoes">Configurações</a></p><h1>Microsoft 365 · SharePoint</h1>
      <p class="dica">Liga o Diligo à biblioteca de documentos do escritório no SharePoint: cada processo pode ser vinculado à sua pasta, que passa a aparecer na ficha do processo, e os anexos enviados pelo histórico e os comprovantes de protocolo são copiados para lá.</p>
      ${!msConfigurado(env) ? html`<section class="cartao"><h2>Configuração inicial</h2>
        <ol class="passos-ms">
          <li>No portal <strong>Microsoft Entra</strong> (entra.microsoft.com) › Aplicativos › Registros de aplicativo › <strong>Novo registro</strong>: nome "Diligo", contas "somente deste diretório organizacional".</li>
          <li>Em <strong>URI de redirecionamento</strong> (Web), informe: <code>${urlRetorno(req)}</code></li>
          <li>Em <strong>Certificados e segredos</strong>, crie um segredo do cliente.</li>
          <li>Em <strong>Permissões de API</strong> › Microsoft Graph › Delegadas: <code>Files.ReadWrite.All</code>, <code>Sites.ReadWrite.All</code>, <code>User.Read</code>, <code>offline_access</code>.</li>
          <li>Cadastre na Cloudflare os segredos <code>MS_CLIENT_ID</code> (ID do aplicativo), <code>MS_CLIENT_SECRET</code> (valor do segredo) e <code>MS_TENANT</code> (ID do diretório) e publique de novo.</li>
        </ol></section>`
      : html`<section class="cartao"><h2>Conexão</h2>
        ${alvo.conta ? html`<dl class="ficha">
            <div><dt>Conta</dt><dd>${alvo.conta.nome} · ${alvo.conta.email}</dd></div>
            <div><dt>Site</dt><dd>${alvo.site ? linkExterno(alvo.site.url, alvo.site.nome) : "—"}</dd></div>
            <div><dt>Biblioteca</dt><dd>${alvo.drive?.nome || "—"}</dd></div>
            <div><dt>Pasta raiz</dt><dd>${alvo.pasta?.nome || "—"}</dd></div></dl>
          <div class="botoes-form">
            ${alvo.site ? html`<form method="post">${campoCsrf(sessao)}<button type="submit" name="acao" value="trocar" class="botao-secundario">Trocar site/biblioteca</button></form>` : ""}
            <form method="post" data-confirmar="Desconectar o Microsoft 365? Os vínculos das pastas continuam guardados.">${campoCsrf(sessao)}<button type="submit" name="acao" value="desconectar" class="botao-perigo">Desconectar</button></form>
          </div>`
          : html`<p>Conecte com uma conta do Microsoft 365 do escritório que tenha acesso à biblioteca dos processos. O Diligo usará essa conta para ler e gravar os arquivos.</p>
          <p><a class="botao-link" href="/sistema/microsoft/conectar">Conectar conta Microsoft</a></p>`}
      </section>${etapa}`}
      <script src="/assets/js/confirmar.js" defer></script>`,
  }));
}

// ---------- Pasta do processo ----------
export async function processoSharepoint(req, env, sessao, id, sub) {
  const proc = await env.DB.prepare(`SELECT p.id, p.pasta, p.numero, p.sharepoint_drive, p.sharepoint_item, p.sharepoint_nome, p.sharepoint_url, c.nome AS cliente
    FROM processos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`).bind(Number(id)).first();
  if (!proc) return resposta(pagina({ titulo: "Não encontrado", sessao, corpo: html`<h1>Processo não encontrado</h1>` }), 404);
  const volta = (msg, extra = "") => redirecionar(`/sistema/processos/${proc.id}?msg=${msg}${extra}#sharepoint`);
  const alvo = msConfigurado(env) ? await lerAlvo(env) : { pronto: false };

  if (sub === "lista") {
    const frag = (corpo) => resposta(corpo, 200, { "Cache-Control": "no-store" });
    if (!alvo.pronto) return frag(html`<p class="vazio">O SharePoint ainda não foi conectado.${sessao.perfil === "admin" ? html` <a href="/sistema/microsoft">Configurar</a>` : " Peça a um administrador para configurar."}</p>`);
    if (!proc.sharepoint_item) return frag(html`<p class="vazio">Nenhuma pasta do SharePoint vinculada a este processo.</p>
      <p><a class="botao-link botao-pequeno" href="/sistema/processos/${String(proc.id)}/sharepoint/vincular">Vincular pasta</a></p>`);
    try {
      const itens = await listarPasta(env, proc.sharepoint_drive, proc.sharepoint_item);
      return frag(html`<div class="topo-sharepoint"><span>📁 ${linkExterno(proc.sharepoint_url, proc.sharepoint_nome || "Pasta do processo")}</span>
          <span class="botoes-titulo">${linkExterno(proc.sharepoint_url, "Abrir no SharePoint", "botao-link botao-secundario botao-pequeno")}
          <a class="botao-link botao-secundario botao-pequeno" href="/sistema/processos/${String(proc.id)}/sharepoint/vincular">Trocar pasta</a></span></div>
        ${itens.length ? html`<ul class="lista-arquivos">${itens.map((x) => html`<li>
            <span class="${`tipo-arquivo ${x.folder ? "" : extensao(x.name) === "PDF" ? "pdf" : /^(JPG|JPEG|PNG|WEBP|GIF)$/.test(extensao(x.name)) ? "imagem" : ""}`}">${x.folder ? "📁" : extensao(x.name) || "ARQ"}</span>
            <div class="arquivo-dados">${linkExterno(x.webUrl, x.name, "arquivo-nome")}
              <small>${x.folder ? `${x.folder.childCount ?? 0} item(ns)` : tamanho(x.size)}${x.lastModifiedDateTime ? ` · ${dataBR(x.lastModifiedDateTime.slice(0, 10))}` : ""}</small></div></li>`)}</ul>`
          : html`<p class="vazio">A pasta está vazia.</p>`}
        <form method="post" action="/sistema/processos/${String(proc.id)}/sharepoint/enviar" enctype="multipart/form-data" class="form-linha envio-sharepoint">${campoCsrf(sessao)}
          <input type="file" name="arquivo" required aria-label="Arquivo para enviar ao SharePoint"><button type="submit" class="botao-pequeno">Enviar para a pasta</button></form>`);
    } catch (e) {
      return frag(html`<p class="erro">${e.message}</p><p><a class="botao-link botao-secundario botao-pequeno" href="/sistema/processos/${String(proc.id)}/sharepoint/vincular">Vincular outra pasta</a></p>`);
    }
  }

  if (sub === "vincular") {
    if (!alvo.pronto) return redirecionar(`/sistema/processos/${proc.id}#sharepoint`);
    if (req.method === "POST") {
      const { f, ok } = await csrfOk(req, sessao);
      if (!ok) return volta("sessao");
      try {
        let item;
        if (f.get("acao") === "criar") item = await criarPasta(env, alvo.drive.id, txt(f, "pai", 300) || alvo.pasta.id, txt(f, "nome", 200) || `Pasta ${proc.pasta || proc.id}`);
        else if (f.get("acao") === "desvincular") {
          await env.DB.prepare("UPDATE processos SET sharepoint_drive = NULL, sharepoint_item = NULL, sharepoint_nome = NULL, sharepoint_url = NULL WHERE id = ?").bind(proc.id).run();
          await auditar(env, req, sessao.usuario_id, "sharepoint_desvinculado", `processo ${proc.id}`);
          return volta("sp_desvinculado");
        } else item = await lerItem(env, alvo.drive.id, txt(f, "item", 300));
        if (!item?.id || item.folder === undefined && f.get("acao") !== "criar") return volta("sp_erro", "&m=Escolha%20uma%20pasta");
        await env.DB.prepare("UPDATE processos SET sharepoint_drive = ?, sharepoint_item = ?, sharepoint_nome = ?, sharepoint_url = ? WHERE id = ?")
          .bind(alvo.drive.id, item.id, item.name, item.webUrl || null, proc.id).run();
        await auditar(env, req, sessao.usuario_id, "sharepoint_vinculado", `processo ${proc.id} → ${item.name}`);
        return volta("sp_vinculado");
      } catch (e) { return volta("sp_erro", `&m=${encodeURIComponent(e.message.slice(0, 200))}`); }
    }
    const url = new URL(req.url);
    const atual = url.searchParams.get("pasta") || alvo.pasta.id;
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 80);
    let corpo;
    try {
      const [item, filhos] = await Promise.all([lerItem(env, alvo.drive.id, atual), listarPasta(env, alvo.drive.id, atual)]);
      const pastas = filhos.filter((x) => x.folder && (!q || x.name.toLowerCase().includes(q)));
      const naRaiz = atual === alvo.pasta.id;
      const pai = !naRaiz ? item.parentReference?.id : null;
      const sugestao = [`Pasta ${proc.pasta || proc.id}`, proc.cliente].filter(Boolean).join(" - ");
      corpo = html`<section class="cartao">
        <p class="dica">Pasta atual: <strong>${naRaiz ? alvo.pasta.nome : item.name}</strong>${naRaiz ? "" : html` · <a href="/sistema/processos/${String(proc.id)}/sharepoint/vincular">voltar à pasta raiz</a>`}${pai && !naRaiz ? html` · <a href="/sistema/processos/${String(proc.id)}/sharepoint/vincular?pasta=${encodeURIComponent(pai)}">subir um nível</a>` : ""}</p>
        <form method="get" class="busca"><input type="hidden" name="pasta" value="${atual}"><input name="q" value="${q}" placeholder="Filtrar pastas por nome (ex.: ${proc.pasta || "35"})" aria-label="Filtrar pastas"><button type="submit">Filtrar</button></form>
        ${pastas.length ? html`<ul class="lista-ms">${pastas.map((x) => html`<li><span>📁 <a href="/sistema/processos/${String(proc.id)}/sharepoint/vincular?pasta=${encodeURIComponent(x.id)}">${x.name}</a> <small>${x.folder.childCount ?? 0} item(ns)</small></span>
          <form method="post">${campoCsrf(sessao)}<input type="hidden" name="item" value="${x.id}"><button type="submit" class="botao-pequeno">Vincular esta pasta</button></form></li>`)}</ul>`
          : html`<p class="vazio">${q ? "Nenhuma pasta com esse nome aqui." : "Nenhuma subpasta aqui."}</p>`}
        ${!naRaiz ? html`<form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="item" value="${atual}"><button type="submit" class="botao-secundario">Vincular a pasta atual (${item.name})</button></form>` : ""}
        <h3 class="subtitulo-calculo">Criar pasta nova aqui e vincular</h3>
        <form method="post" class="form-linha">${campoCsrf(sessao)}<input type="hidden" name="acao" value="criar"><input type="hidden" name="pai" value="${atual}">
          <input name="nome" value="${sugestao}" maxlength="200" aria-label="Nome da nova pasta" class="campo-nome-pasta"><button type="submit" class="botao-pequeno">Criar e vincular</button></form>
        ${proc.sharepoint_item ? html`<form method="post" class="form-excluir-andamento" data-confirmar="Desvincular a pasta do SharePoint deste processo? Os arquivos não são apagados.">${campoCsrf(sessao)}<input type="hidden" name="acao" value="desvincular">
          <button type="submit" class="botao-perigo">Desvincular pasta atual</button></form>` : ""}
      </section>`;
    } catch (e) { corpo = html`<p class="erro">${e.message}</p>`; }
    return resposta(pagina({
      titulo: "Vincular pasta do SharePoint", sessao,
      corpo: html`<p class="trilha"><a href="/sistema/processos/${String(proc.id)}">${proc.pasta ? `Pasta ${proc.pasta}` : "Processo"}</a></p>
        <h1>Vincular pasta do SharePoint</h1><p class="subtitulo">${[proc.numero, proc.cliente].filter(Boolean).join(" · ")}</p>${corpo}
        <script src="/assets/js/confirmar.js" defer></script>`,
    }));
  }

  if (sub === "enviar" && req.method === "POST") {
    const { f, ok } = await csrfOk(req, sessao);
    if (!ok) return volta("sessao");
    const arq = f.get("arquivo");
    if (!proc.sharepoint_item || !arq || typeof arq === "string" || !arq.size) return volta("sp_erro", "&m=Escolha%20um%20arquivo");
    if (arq.size > LIMITE_ANEXO) return volta("sp_erro", "&m=O%20arquivo%20passa%20de%2020%20MB");
    try {
      await enviarArquivo(env, proc.sharepoint_drive, proc.sharepoint_item, arq.name, new Uint8Array(await arq.arrayBuffer()));
      await auditar(env, req, sessao.usuario_id, "sharepoint_enviado", `processo ${proc.id}: ${arq.name}`);
      return volta("sp_enviado");
    } catch (e) { return volta("sp_erro", `&m=${encodeURIComponent(e.message.slice(0, 200))}`); }
  }
  return redirecionar(`/sistema/processos/${proc.id}#sharepoint`);
}
