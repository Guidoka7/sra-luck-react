// J15 — relatório em PDF gerado pela equipe (catálogo → gerar → arquivo PDF válido)
import { BASE, CREDS, EV } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
execFileSync("psql", ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-qc", "delete from public.login_rate_limits"]);
const H = { Origin: BASE, "Content-Type": "application/json" };
const l = await fetch(`${BASE}/api/admin/auth`, { method: "POST", headers: H, body: JSON.stringify({ email: CREDS.QA_ADMIN_EMAIL, senha: CREDS.QA_ADMIN_PASSWORD }) });
const cookie = l.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const r0 = {};
const cat = await (await fetch(`${BASE}/api/admin/relatorios/catalogo`, { headers: { Cookie: cookie } })).json();
const lista = (cat.grupos || []).flatMap((g) => g.itens || []);
const primeiro = lista.find((x) => x.modulo === "financeiro") || lista[0] || {};
r0.escolhido = primeiro.id;
Object.assign(r0, { catalogo: lista.length });
const r = r0;
const dir = `${EV}/J15-relatorio-pdf`; mkdirSync(dir, { recursive: true });
for (const formato of ["pdf", "xlsx"]) {
  const g = await fetch(`${BASE}/api/admin/relatorios/gerar`, { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ relatorioId: primeiro.id, formato, filtros: {}, periodoLabel: "QA" }) });
  const buf = Buffer.from(await g.arrayBuffer());
  const ct = g.headers.get("content-type") || "";
  let arquivo = buf;
  if (ct.includes("json")) { const j = JSON.parse(buf.toString()); r[`${formato}_json`] = Object.keys(j); const b64 = j.arquivoBase64 || j.base64 || j.conteudo; if (b64) arquivo = Buffer.from(b64, "base64"); else if (j.url) { const d = await fetch(j.url.startsWith("http") ? j.url : BASE + j.url, { headers: { Cookie: cookie } }); arquivo = Buffer.from(await d.arrayBuffer()); } }
  writeFileSync(`${dir}/relatorio-qa.${formato}`, arquivo);
  r[formato] = { status: g.status, contentType: ct, bytes: arquivo.length, assinatura: arquivo.subarray(0, 5).toString("latin1") };
}
r.historico = (await (await fetch(`${BASE}/api/admin/relatorios/historico`, { headers: { Cookie: cookie } })).json());
r.historico = JSON.stringify(r.historico).slice(0, 300);
writeFileSync(`${dir}/result.json`, JSON.stringify(r, null, 1));
console.log(JSON.stringify(r, null, 1));
