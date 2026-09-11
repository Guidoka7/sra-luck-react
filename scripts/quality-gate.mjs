import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const roots = [
  "worker/providers",
  "worker/middleware",
  "worker/routes",
  "worker/validation.ts",
  "worker/observability.ts",
  "worker/supabase.ts",
  "src/main.tsx",
  "src/features/auth",
  "src/features/client/ClientCreditLiveApp.tsx",
  "src/lib/http.ts",
];

const rules = [
  { label: "console.log", pattern: /\bconsole\.log\s*\(/g },
  { label: "console.error", pattern: /\bconsole\.error\s*\(/g },
  { label: "comentário pendente", pattern: /\b(?:TODO|FIXME|HACK|TEMP)\b/g },
  { label: "tipo any", pattern: /(?:\:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Record<[^>]*\bany\b[^>]*>)/g },
  { label: "credencial suspeita", pattern: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|service[_-]?role[_-]?key)\s*[:=]\s*["'][A-Za-z0-9._-]{16,}["']/gi },
];

function collect(path) {
  const info = statSync(path);
  if (info.isFile()) return [path];
  return readdirSync(path).flatMap((name) => collect(join(path, name)));
}

const files = roots.flatMap(collect).filter((file) => [".ts", ".tsx", ".js", ".mjs"].includes(extname(file)));
const violations = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push(`${relative(process.cwd(), file)}:${line} — ${rule.label}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Quality gate falhou:\n${violations.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Quality gate aprovado em ${files.length} arquivos de runtime crítico.\n`);
