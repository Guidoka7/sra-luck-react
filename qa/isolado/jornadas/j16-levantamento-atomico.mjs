// J16 — levantamento atômico pela API real: falha forçada na auditoria (só QA) desfaz a decisão
import { BASE, CREDS, EV } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const PG = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execFileSync("psql", [PG, "-Atc", q], { encoding: "utf8" }).trim();
const ID = "a0000000-0000-4000-8000-000000000010";
sql("delete from public.login_rate_limits");
// QA-10 Júlia: elegível (15/24) com liberação solicitada — dados fictícios
if (sql(`select count(*) from clientes where id='${ID}'`) === "0") {
  execFileSync("psql", [PG, "-v", "ON_ERROR_STOP=1", "-qf", "/home/user/qa-supabase/seed/04_seed_julia.sql"]);
}
const H = { Origin: BASE, "Content-Type": "application/json" };
const l = await fetch(`${BASE}/api/admin/auth`, { method: "POST", headers: H, body: JSON.stringify({ email: CREDS.QA_ADMIN_EMAIL, senha: CREDS.QA_ADMIN_PASSWORD }) });
const cookie = l.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const estado = () => sql(`select json_build_object('status', status_revisao_financeira, 'saldo', financeiro_saldo_restante, 'formas', financeiro_formas_custeio, 'confirmado_em', financeiro_confirmado_em, 'por', financeiro_levantamento_confirmado_por, 'logs_levantamento', (select count(*) from logs_alteracoes where entidade_id='${ID}' and acao like '%levantamento%')) from clientes where id='${ID}'`);
const concluir = async () => { const r = await fetch(`${BASE}/api/admin/clientes/${ID}/revisao-financeira`, { method: "POST", headers: { ...H, Cookie: cookie }, body: JSON.stringify({ decisao: "aprovada", saldoRestante: 4500, formasCusteio: ["pix", "cartao"], taxaCartao: 5.4 }) }); return { status: r.status, body: await r.text() }; };
const r = { login: l.status };
r.antes = JSON.parse(estado());
// Falha forçada (SOMENTE no QA): trigger que recusa auditoria de levantamento
sql(`create or replace function public.qa_falhar_auditoria() returns trigger language plpgsql as $f$ begin if new.acao like '%levantamento%' then raise exception 'AUDITORIA_INDISPONIVEL_QA'; end if; return new; end $f$;
     drop trigger if exists zz_qa_falhar_auditoria on public.logs_alteracoes;
     create trigger zz_qa_falhar_auditoria before insert on public.logs_alteracoes for each row execute function public.qa_falhar_auditoria();`);
r.comFalhaNaAuditoria = await concluir();
r.depoisDaFalha = JSON.parse(estado());
sql("drop trigger zz_qa_falhar_auditoria on public.logs_alteracoes; drop function public.qa_falhar_auditoria();");
r.semFalha = await concluir();
r.depoisDoSucesso = JSON.parse(estado());
r.auditoria = sql(`select json_agg(json_build_object('usuario', usuario, 'acao', acao, 'detalhes', detalhes)) from logs_alteracoes where entidade_id='${ID}' and acao like '%levantamento%'`);
r.provas = {
  falhaNaoRespondeSucesso: r.comFalhaNaAuditoria.status >= 500,
  decisaoDesfeita: JSON.stringify(r.antes) === JSON.stringify(r.depoisDaFalha),
  sucessoGravaTudo: r.semFalha.status === 200 && r.depoisDoSucesso.status === "aprovada" && r.depoisDoSucesso.logs_levantamento === 1 && Boolean(r.depoisDoSucesso.por),
};
mkdirSync(`${EV}/J16-levantamento-atomico`, { recursive: true });
writeFileSync(`${EV}/J16-levantamento-atomico/result.json`, JSON.stringify(r, null, 1));
console.log(JSON.stringify(r, null, 1));
