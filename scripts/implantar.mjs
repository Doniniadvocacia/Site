// Implantação no Cloudflare (comando de implantação: npm run implantar).
// 1) aplica as migrações do banco D1;
// 2) publica o Worker repassando como segredos de execução os valores cadastrados
//    na seção "Variáveis e segredos da build" do painel.
// 3) garante o bucket R2 dos anexos; se o R2 ainda não estiver ativado na conta,
//    publica sem ele (o sistema funciona e avisa que anexos estão indisponíveis).
// Os valores nunca são impressos; o registro mostra apenas os nomes.
import { execSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const NOMES = ["DATA_KEY", "SETUP_TOKEN", "WIX_API_KEY", "ASAAS_API_KEY", "ANTHROPIC_API_KEY"];
const segredos = Object.fromEntries(
  NOMES.filter((n) => process.env[n] && process.env[n].trim()).map((n) => [n, process.env[n].trim()])
);

const rodar = (cmd) => execSync(cmd, { stdio: "inherit" });

rodar("npx wrangler d1 migrations apply diligo --remote");

// R2: cria o bucket (se já existir, segue). Sem R2 ativado, publica sem o binding.
let config = "";
try {
  execSync("npx wrangler r2 bucket create diligo-arquivos", { stdio: "pipe" });
  console.log("Bucket R2 diligo-arquivos criado.");
} catch (e) {
  const saida = `${e.stdout || ""}${e.stderr || ""}`;
  if (/already exists|já existe|10004/i.test(saida)) {
    console.log("Bucket R2 diligo-arquivos já existe.");
  } else {
    console.log("R2 indisponível nesta conta (ative o R2 no painel do Cloudflare). Publicando sem anexos.");
    console.log(saida.split("\n").filter((l) => /error|erro|r2/i.test(l)).slice(0, 3).join("\n"));
    const texto = readFileSync("wrangler.jsonc", "utf8").replace(/^\s*"r2_buckets".*$/m, "");
    config = "wrangler.sem-r2.jsonc";
    writeFileSync(config, texto);
  }
}
const extra = config ? ` --config ${config}` : "";

const nomes = Object.keys(segredos);
if (!nomes.length) {
  console.log("Nenhum segredo encontrado nas variáveis da build; publicando sem enviar segredos.");
  rodar(`npx wrangler deploy${extra}`);
} else {
  const pasta = mkdtempSync(path.join(tmpdir(), "segredos-"));
  const arquivo = path.join(pasta, "segredos.json");
  writeFileSync(arquivo, JSON.stringify(segredos), { mode: 0o600 });
  try {
    console.log(`Enviando segredos: ${nomes.join(", ")}`);
    const faltando = NOMES.filter((n) => !segredos[n]);
    if (faltando.length) console.log(`Não encontrados nas variáveis da build: ${faltando.join(", ")}`);
    rodar(`npx wrangler deploy${extra} --secrets-file "${arquivo}"`);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
