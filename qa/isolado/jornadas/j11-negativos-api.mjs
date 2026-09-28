// J11 — regras autoritativas no backend (sem UI): cada chamada deve ser RECUSADA
import { BASE, CREDS, EV } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const PG = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
execFileSync("psql", [PG, "-qc", "delete from public.login_rate_limits"]);
const H = { Origin: BASE, "Content-Type": "application/json" };
async function login(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  return { status: r.status, cookie: (r.headers.getSetCookie() || []).map((c) => c.split(";")[0]).join("; ") };
}
async function call(method, path, cookie, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { ...H, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const t = await r.text(); return { status: r.status, body: t.slice(0, 220) };
}
const out = [];
const caso = (nome, esperado, res) => { out.push({ nome, esperado, ...res, ok: String(esperado).split("|").map(Number).includes(res.status) }); };

const camila = await login("/api/cliente/auth", { cpf: "90000000337", dataNascimento: "1992-05-05" });
const fernanda = await login("/api/cliente/auth", { cpf: "90000000680", dataNascimento: "1991-09-09" });
const bruna = await login("/api/cliente/auth", { cpf: "90000000256", dataNascimento: "1988-03-20" });
const vend = await login("/api/admin/auth", { email: CREDS.QA_VENDEDORA_EMAIL, senha: CREDS.QA_VENDEDORA_PASSWORD });
out.push({ nome: "logins de apoio", camila: camila.status, fernanda: fernanda.status, bruna: bruna.status, vendedora: vend.status });

caso("Camila (termos assinados, prazo 5 d.u. não atingido) tenta escolher cirurgia", "400|409|422", await call("POST", "/api/cliente/agendar-cirurgia", camila.cookie, { data: "2027-01-15", horario: "10:00" }));
caso("Fernanda (41,7% < 60%) tenta solicitar liberação", "400|403|409|422", await call("POST", "/api/cliente/agenda/solicitar-liberacao", fernanda.cookie, {}));
const datas = JSON.parse(execFileSync("psql", [PG, "-Atc", "select json_agg(id) from datas where data > (timezone('America/Sao_Paulo',now()))::date"], { encoding: "utf8" }));
caso("Bruna (já tem termos agendados) tenta agendar de novo", "400|409|422", await call("POST", "/api/cliente/agendar", bruna.cookie, { dataId: datas[1], horario: "11:00" }));
caso("Cliente sem sessão acessa boletos", "401", await call("GET", "/api/cliente/boletos", null));
caso("Cookie de cliente em rota administrativa", "401|403", await call("GET", "/api/admin/clientes", camila.cookie));
caso("Vendedora sem permissão conclui levantamento", "403", await call("POST", "/api/admin/clientes/a0000000-0000-4000-8000-000000000006/revisao-financeira", vend.cookie, { decisao: "aprovada", saldoRestante: 1, formasCusteio: ["pix"] }));
caso("Vendedora sem permissão registra quitação", "403", await call("POST", "/api/admin/central/quitacao", vend.cookie, { agendamentoId: "00000000-0000-4000-8000-000000000000", recebido: true }));
caso("POST cross-site com cookie de equipe", "403", await (async () => { const r = await fetch(`${BASE}/api/admin/central/quitacao`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: vend.cookie }, body: "{}" }); return { status: r.status, body: (await r.text()).slice(0, 120) }; })());
// Regra dos 90 dias no banco (RPC autoritativa), dentro de transação desfeita no fim
let antes; try { antes = execFileSync("psql", [PG, "-Atc", "begin; update agendamentos set data_cirurgia=null, horario_cirurgia=null where cliente_id='a0000000-0000-4000-8000-000000000004'; insert into datas_liberacao_financeira (data,vagas_totais) values ('2026-12-26',2) on conflict do nothing; select public.agenda_reservar_cirurgia('a0000000-0000-4000-8000-000000000004','2026-12-26','09:00'); rollback;"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { antes = "RECUSADO: " + String(e.stderr).split("\n")[0]; }
out.push({ nome: "Daniela continua com a cirurgia de 08/01/2027 (transação desfeita)", resultado: execFileSync("psql", [PG, "-Atc", "select data_cirurgia from agendamentos where cliente_id='a0000000-0000-4000-8000-000000000004'"], { encoding: "utf8" }).trim() });
out.push({ nome: "RPC reservar 26/12 (antes de termos+90 = 27/12)", resultado: antes });
mkdirSync(`${EV}/J11-regras-backend`, { recursive: true });
writeFileSync(`${EV}/J11-regras-backend/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
