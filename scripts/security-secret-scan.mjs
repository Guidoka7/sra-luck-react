import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".wrangler", "coverage", "vendor"]);
const IGNORED_FILES = new Set(["package-lock.json", "scripts/security-secret-scan.mjs"]);

const rules = [
  { name: "private-key", re: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/g },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "mercado-pago-token", re: /\bAPP_USR-[A-Za-z0-9-]{20,}\b/g },
  {
    name: "sensitive-env-assignment",
    re: /\b(?:SUPABASE_SERVICE_ROLE_KEY|CLIENTE_SESSION_SECRET|INTEGRATION_ENCRYPTION_KEY|TURNSTILE_SECRET_KEY|MERCADO_PAGO_ACCESS_TOKEN|MERCADO_PAGO_WEBHOOK_SECRET|RD_CLIENT_SECRET|RD_WEBHOOK_SECRET|CONTA_AZUL_CLIENT_SECRET|CONTA_AZUL_ACCESS_TOKEN|WEB_PUSH_VAPID_PRIVATE_KEY|BRB_WEBHOOK_SECRET|BB_WEBHOOK_SECRET|SANTANDER_WEBHOOK_SECRET|SICREDI_WEBHOOK_SECRET|EFI_WEBHOOK_SECRET)\s*[:=]\s*["']?([^\s"'`,;]{16,})/gi,
  },
];

function looksPlaceholder(value) {
  const v = String(value || "").toLowerCase();
  return !v || v.includes("placeholder") || v.includes("example") || v.includes("changeme") || v.includes("dummy") || v.includes("redacted") || v.startsWith("${") || v.startsWith("<");
}

function hits(text, source) {
  const found = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (const match of text.matchAll(rule.re)) {
      if (rule.name === "sensitive-env-assignment" && looksPlaceholder(match[1])) continue;
      found.push({ rule: rule.name, source });
    }
  }
  return found;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).replaceAll("\\", "/");
    if (IGNORED_FILES.has(rel)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!IGNORED_DIRS.has(name)) walk(full, out);
      continue;
    }
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    try {
      const text = readFileSync(full, "utf8");
      if (text.includes("\u0000")) continue;
      out.push(...hits(text, `working-tree:${rel}`));
    } catch {
      // Arquivos não textuais são ignorados.
    }
  }
  return out;
}

function scanHistory() {
  let patch = "";
  try {
    patch = execFileSync(
      "git",
      ["log", "-p", "--all", "--format=@@COMMIT:%H", "--", ".", ":(exclude)package-lock.json", ":(exclude)vendor/**", ":(exclude)scripts/security-secret-scan.mjs"],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
    );
  } catch (error) {
    console.error("security-secret-scan: não foi possível ler o histórico Git.");
    process.exit(2);
  }

  let commit = "unknown";
  let file = "unknown";
  const found = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@COMMIT:")) { commit = line.slice(9).trim(); continue; }
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) { file = line.slice(6).trim(); continue; }
    if (!(line.startsWith("+") || line.startsWith("-")) || line.startsWith("+++") || line.startsWith("---")) continue;
    const source = `history:${file}@${commit.slice(0, 12)}`;
    found.push(...hits(line.slice(1), source));
  }
  return found;
}

const findings = [...walk(ROOT), ...scanHistory()];
const unique = [...new Map(findings.map((item) => [`${item.rule}:${item.source}`, item])).values()];
if (unique.length > 0) {
  console.error(`security-secret-scan: ${unique.length} possível(is) segredo(s) de alta confiança encontrado(s).`);
  for (const item of unique.slice(0, 50)) console.error(`- ${item.rule} em ${item.source}`);
  if (unique.length > 50) console.error(`- ... e mais ${unique.length - 50} ocorrência(s).`);
  console.error("Os valores não são exibidos para evitar novo vazamento. Rotacione qualquer segredo real antes de limpar o histórico.");
  process.exit(1);
}
console.log("security-secret-scan: nenhum segredo de alta confiança encontrado no working tree ou histórico Git.");
