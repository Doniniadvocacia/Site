// Implantação no Cloudflare (comando de implantação: npm run implantar).
// 1) aplica as migrações do banco D1;
// 2) publica o Worker repassando como segredos de execução os valores cadastrados
//    na seção "Variáveis e segredos da build" do painel.
// Os valores nunca são impressos; o registro mostra apenas os nomes.
import { execSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const NOMES = ["DATA_KEY", "SETUP_TOKEN", "WIX_API_KEY"];
const segredos = Object.fromEntries(
  NOMES.filter((n) => process.env[n] && process.env[n].trim()).map((n) => [n, process.env[n].trim()])
);

const rodar = (cmd) => execSync(cmd, { stdio: "inherit" });

rodar("npx wrangler d1 migrations apply diligo --remote");

const nomes = Object.keys(segredos);
if (!nomes.length) {
  console.log("Nenhum segredo encontrado nas variáveis da build; publicando sem enviar segredos.");
  rodar("npx wrangler deploy");
} else {
  const pasta = mkdtempSync(path.join(tmpdir(), "segredos-"));
  const arquivo = path.join(pasta, "segredos.json");
  writeFileSync(arquivo, JSON.stringify(segredos), { mode: 0o600 });
  try {
    console.log(`Enviando segredos: ${nomes.join(", ")}`);
    const faltando = NOMES.filter((n) => !segredos[n]);
    if (faltando.length) console.log(`Não encontrados nas variáveis da build: ${faltando.join(", ")}`);
    rodar(`npx wrangler deploy --secrets-file "${arquivo}"`);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
