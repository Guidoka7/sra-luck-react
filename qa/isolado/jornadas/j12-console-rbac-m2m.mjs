// J12 — RBAC do Dev Console + M2M real contra o app do QA (owner / operator / viewer)
import { CREDS, EV } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const CONSOLE = "http://localhost:3200", APP = "http://localhost:3100";
const PG_APP = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PG_DEV = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const sql = (pg, q) => execFileSync("psql", [pg, "-Atc", q], { encoding: "utf8" }).trim();
const FLOW = process.env.FLOW || "J12-console-rbac-m2m";
const out = { casos: [] };
const caso = (papel, nome, esperado, res) => out.casos.push({ papel, nome, esperado, status: res.status, codigo: res.codigo, ok: String(esperado).split("|").map(Number).includes(res.status) });

async function login(email, password) {
  const r = await fetch(`${CONSOLE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: CONSOLE }, body: JSON.stringify({ email, password }) });
  return { status: r.status, cookie: (r.headers.getSetCookie() || []).map((c) => c.split(";")[0]).join("; ") };
}
async function req(cookie, method, url, body) {
  const r = await fetch(url, { method, headers: { Cookie: cookie, Origin: CONSOLE, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { status: r.status, codigo: j.codigo || j.code || null, body: j };
}
const proxy = (cookie, method, path, body) => req(cookie, method, `${CONSOLE}/api/sra-proxy?path=${encodeURIComponent(path)}`, body);

const bruna = sql(PG_APP, "select id from agendamentos where cliente_id='a0000000-0000-4000-8000-000000000002'");
const auditAntes = Number(sql(PG_DEV, "select count(*) from dev_audit_logs"));
const papeis = { owner: ["QA_CONSOLE_OWNER_EMAIL", "QA_CONSOLE_OWNER_PASSWORD", "2027-01-11"], operator: ["QA_CONSOLE_OPERATOR_EMAIL", "QA_CONSOLE_OPERATOR_PASSWORD", "2027-01-12"], viewer: ["QA_CONSOLE_VIEWER_EMAIL", "QA_CONSOLE_VIEWER_PASSWORD", "2027-01-13"] };
for (const [papel, [e, p, previsao]] of Object.entries(papeis)) {
  const s = await login(CREDS[e], CREDS[p]);
  caso(papel, "login no Console", "200", s);
  const c = s.cookie;
  caso(papel, "leitura M2M: GET /api/admin/visao-geral via proxy", "200", await proxy(c, "GET", "/api/admin/visao-geral"));
  caso(papel, "leitura M2M: GET /api/admin/central/visao-geral (jornada)", "200", await proxy(c, "GET", "/api/admin/central/visao-geral"));
  const esperadoEscrita = papel === "viewer" ? "403" : "200";
  caso(papel, `escrita mapeada (v46.correct): POST /api/admin/central/previsao → ${previsao}`, esperadoEscrita, await proxy(c, "POST", "/api/admin/central/previsao", { agendamentoId: bruna, previsao }));
  caso(papel, "escrita sem mapeamento explícito (sra.admin.write): POST /api/admin/regras-operacionais com payload inválido", papel === "owner" ? "400|422" : "403", await proxy(c, "POST", "/api/admin/regras-operacionais", { prazo_liberacao_dias_uteis: 999 }));
  caso(papel, "cofre: GET /api/connections-secrets", "200", await req(c, "GET", `${CONSOLE}/api/connections-secrets`));
  caso(papel, "cofre: salvar GEMINI_MODEL (não sensível) no cofre", papel === "viewer" ? "403" : papel === "owner" ? "200" : (process.env.OPERATOR_SECRETS_EXPECT || "403"), await req(c, "POST", `${CONSOLE}/api/connections-secrets`, { action: "save", key: "GEMINI_MODEL", value: `qa-${papel}` }));
  caso(papel, "cofre: trocar SRA_LUCK_SERVICE_TOKEN (sensível)", papel === "owner" ? "200" : (papel === "viewer" ? "403" : (process.env.OPERATOR_SECRETS_EXPECT || "403")), await req(c, "POST", `${CONSOLE}/api/connections-secrets`, { action: "remove", key: "SRA_LUCK_SERVICE_TOKEN" }));
  caso(papel, "gestão de usuários do Console: GET /api/dev-users", papel === "owner" ? "200" : "403", await req(c, "GET", `${CONSOLE}/api/dev-users`));
  out[`previsao_apos_${papel}`] = sql(PG_APP, `select previsao_cirurgia from agendamentos where id='${bruna}'`);
}
// Backend do app: M2M direto (sem Console), token certo/errado e papel no header
const token = CREDS.QA_DEV_CONSOLE_TOKEN;
async function direto(method, path, headers, body) {
  const r = await fetch(`${APP}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { status: r.status, codigo: j.codigo || j.code || null };
}
caso("backend", "M2M token inválido", "401", await direto("GET", "/api/admin/visao-geral", { "x-dev-console-token": "x".repeat(64), "x-dev-actor-id": "qa", "x-dev-actor-role": "owner" }));
caso("backend", "M2M viewer GET", "200", await direto("GET", "/api/admin/visao-geral", { "x-dev-console-token": token, "x-dev-actor-id": "qa-viewer", "x-dev-actor-role": "viewer" }));
caso("backend", "M2M viewer POST (burlando o Console)", "403", await direto("POST", "/api/admin/central/previsao", { "x-dev-console-token": token, "x-dev-actor-id": "qa-viewer", "x-dev-actor-role": "viewer" }, { agendamentoId: bruna, previsao: "2027-02-01" }));
caso("backend", "M2M sem papel POST", "403", await direto("POST", "/api/admin/central/previsao", { "x-dev-console-token": token, "x-dev-actor-id": "qa" }, { agendamentoId: bruna, previsao: "2027-02-01" }));
caso("backend", "M2M papel forjado 'admin' POST", "403", await direto("POST", "/api/admin/central/previsao", { "x-dev-console-token": token, "x-dev-actor-id": "qa", "x-dev-actor-role": "admin" }, { agendamentoId: bruna, previsao: "2027-02-01" }));
caso("backend", "Headers M2M em rota de cliente são descartados", "401", await direto("GET", "/api/cliente/boletos", { "x-dev-console-token": token, "x-dev-actor-role": "owner" }));
out.previsao_final = sql(PG_APP, `select previsao_cirurgia from agendamentos where id='${bruna}'`);
out.auditoriaConsole = sql(PG_DEV, `select json_agg(json_build_object('papel', u.role, 'acao', a.action, 'recurso', a.resource, 'status', a.details->>'status', 'metodo', a.details->>'method')) from (select * from dev_audit_logs order by created_at desc limit 30) a left join dev_users u on u.id=a.actor_user_id`);
out.auditoriaNovas = Number(sql(PG_DEV, "select count(*) from dev_audit_logs")) - auditAntes;
out.auditoriaApp = sql(PG_APP, "select json_agg(json_build_object('usuario', usuario, 'acao', acao)) from (select * from logs_alteracoes where acao='confirmou_previsao_cirurgia' order by created_at desc limit 3) x");
out.cofre = sql(PG_DEV, "select json_agg(json_build_object('name', name, 'cifrado', value_cipher is not null and value_cipher <> '', 'updated_by', updated_by is not null)) from dev_connector_secrets");
mkdirSync(`${EV}/${FLOW}`, { recursive: true });
writeFileSync(`${EV}/${FLOW}/result.json`, JSON.stringify(out, null, 1));
for (const c of out.casos) console.log(`${c.ok ? "OK  " : "FALHA"} [${c.papel}] ${c.nome} → ${c.status}${c.codigo ? " " + c.codigo : ""} (esperado ${c.esperado})`);
console.log(JSON.stringify({ previsoes: [out.previsao_apos_owner, out.previsao_apos_operator, out.previsao_apos_viewer, out.previsao_final], auditoriaNovas: out.auditoriaNovas, cofre: out.cofre }, null, 1));
