import { existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function write(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32", ...options });
  if (result.status !== 0) fail(`Falha ao executar: ${command} ${args.join(" ")}`);
}

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(major) || major < 22) fail("Node.js 22 ou superior é obrigatório.");

write("[1/4] Instalando dependências com lockfile...");
run("npm", ["ci"]);

if (!existsSync(".env.local")) {
  copyFileSync(".env.local.example", ".env.local");
  write("[2/4] .env.local criado a partir do exemplo. Preencha apenas valores locais necessários.");
} else {
  write("[2/4] .env.local já existe; arquivo preservado.");
}

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.SUPABASE_POOLER_URL;
if (databaseUrl) {
  write("[3/4] Aplicando migrations idempotentes...");
  run("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", "supabase/migrations.sql"]);
  write("[4/4] Aplicando seed idempotente...");
  run("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", "supabase/seed.sql"]);
} else {
  write("[3/4] Banco não alterado: defina SUPABASE_DB_URL ou SUPABASE_POOLER_URL para aplicar migrations.");
  write("[4/4] Seed não aplicado sem URL de banco.");
}

write("Setup concluído. Use `npm run dev` para iniciar a aplicação.");
