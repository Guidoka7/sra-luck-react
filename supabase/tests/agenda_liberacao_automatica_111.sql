-- Teste da migration_111 e do seu rollback em banco DESCARTÁVEL (nunca em produção).
-- Uso: psql -v ON_ERROR_STOP=1 -f supabase/tests/agenda_liberacao_automatica_111.sql
-- Fixture mínima + definições de produção (28/09/2026) das funções envolvidas.
\set ON_ERROR_STOP 1
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create type status_agendamento as enum ('confirmado','cancelado','realizado');
create table regras_operacionais (id int primary key, prazo_liberacao_dias_uteis int);
insert into regras_operacionais values (1, 5);
create table agendamentos (
  id uuid primary key default gen_random_uuid(), cliente_id uuid default gen_random_uuid(),
  status status_agendamento not null, comparecimento_status text, quitacao_status text,
  comparecimento_em timestamptz, quitacao_em timestamptz, agenda_cirurgica_prazo_ajuste_dias int default 0,
  agenda_cirurgica_liberada_em timestamptz, data_cirurgia date, updated_at timestamptz, rotulo text unique);
create table logs_alteracoes (id uuid primary key default gen_random_uuid(), usuario text, acao text, entidade text, entidade_id uuid, detalhes jsonb, created_at timestamptz default now());

CREATE OR REPLACE FUNCTION public.adicionar_dias_uteis(p_data date, p_dias integer) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
declare resultado date := p_data; adicionados integer := 0;
begin
  if p_data is null then return null; end if;
  if p_dias <= 0 then return resultado; end if;
  while adicionados < p_dias loop
    resultado := resultado + 1;
    if extract(isodow from resultado) between 1 and 5 then adicionados := adicionados + 1; end if;
  end loop;
  return resultado;
end; $f$;

CREATE OR REPLACE FUNCTION public.calcular_prazo_cirurgico_v46(p_comparecimento_em timestamp with time zone, p_quitacao_em timestamp with time zone, p_dias_ajuste integer DEFAULT 0) RETURNS date LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $f$
declare v_base date; v_prazo integer;
begin
  if p_comparecimento_em is null or p_quitacao_em is null then return null; end if;
  select coalesce((select prazo_liberacao_dias_uteis from public.regras_operacionais where id = 1), 5) into v_prazo;
  v_base := greatest((timezone('America/Sao_Paulo', p_comparecimento_em))::date, (timezone('America/Sao_Paulo', p_quitacao_em))::date);
  return public.adicionar_dias_uteis(v_base, v_prazo + greatest(0, coalesce(p_dias_ajuste, 0)));
end; $f$;

CREATE OR REPLACE FUNCTION public.agenda_tentar_liberar_cirurgia(p_agendamento_id uuid, p_usuario text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare v public.agendamentos%rowtype; v_prazo date; v_hoje date := (timezone('America/Sao_Paulo',now()))::date;
begin
  select * into v from public.agendamentos where id = p_agendamento_id for update;
  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;
  if v.status not in ('confirmado','realizado') or v.comparecimento_status <> 'compareceu' or v.quitacao_status <> 'paga' then return false; end if;
  if v.agenda_cirurgica_liberada_em is not null then return true; end if;
  v_prazo := public.calcular_prazo_cirurgico_v46(v.comparecimento_em, v.quitacao_em, v.agenda_cirurgica_prazo_ajuste_dias);
  if v_prazo is null or v_hoje < v_prazo then return false; end if;
  update public.agendamentos set agenda_cirurgica_liberada_em = now(), updated_at = now() where id = p_agendamento_id;
  insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
  values (coalesce(p_usuario,'sistema'),'liberou_agenda_cirurgica','agendamentos',p_agendamento_id, jsonb_build_object('cliente_id',v.cliente_id,'prazo_calculado',v_prazo,'manual',false));
  return true;
end; $f$;

-- Estado de produção ANTES da 111 = o mesmo SQL do rollback.
\ir ../rollback/migration_111_rollback.sql

create or replace function pg_temp.casos() returns void language sql as $$
  truncate agendamentos, logs_alteracoes;
  insert into agendamentos (rotulo,status,comparecimento_status,quitacao_status,comparecimento_em,quitacao_em,data_cirurgia,agenda_cirurgica_liberada_em) values
   ('A_confirmado_vencido','confirmado','compareceu','paga', now()-interval '20 days', now()-interval '20 days', null, null),
   ('B_realizado_vencido','realizado','compareceu','paga', now()-interval '20 days', now()-interval '20 days', null, null),
   ('C_realizado_no_prazo','realizado','compareceu','paga', now(), now(), null, null),
   ('D_realizado_sem_quitacao','realizado','compareceu','pendente', now()-interval '20 days', null, null, null),
   ('E_realizado_ausente','realizado','nao_compareceu','pendente', null, null, null, null),
   ('F_cancelado','cancelado','compareceu','paga', now()-interval '20 days', now()-interval '20 days', null, null),
   ('G_ja_liberado','realizado','compareceu','paga', now()-interval '20 days', now()-interval '20 days', null, now()-interval '5 days'),
   ('H_realizado_com_data_cirurgia','realizado','compareceu','paga', now()-interval '20 days', now()-interval '20 days', current_date+30, null);
$$;

create or replace function pg_temp.liberados() returns text language sql as $$
  select coalesce(string_agg(rotulo, ',' order by rotulo), '') from agendamentos
  where agenda_cirurgica_liberada_em is not null and rotulo <> 'G_ja_liberado';
$$;

-- 1) Antes da 111 (produção atual): só o "confirmado" é liberado.
select pg_temp.casos();
do $$ declare n int; begin
  n := public.agenda_processar_liberacoes_v46();
  if n <> 1 or pg_temp.liberados() <> 'A_confirmado_vencido' then raise exception 'ANTES: esperado só A, veio % (%)', n, pg_temp.liberados(); end if;
end $$;
\echo 'OK antes da 111: realizado com prazo vencido NÃO é liberado (bug confirmado)'

-- 2) Aplica a 111.
\ir ../migration_111_agenda_liberacao_automatica_realizado.sql
select pg_temp.casos();
do $$ declare n int; m int; logs int; begin
  n := public.agenda_processar_liberacoes_v46();
  if n <> 3 or pg_temp.liberados() <> 'A_confirmado_vencido,B_realizado_vencido,H_realizado_com_data_cirurgia'
    then raise exception '111: esperado A,B,H, veio % (%)', n, pg_temp.liberados(); end if;
  m := public.agenda_processar_liberacoes_v46();
  if m <> 0 then raise exception '111: segunda execução deveria liberar 0, liberou %', m; end if;
  select count(*) into logs from logs_alteracoes where acao='liberou_agenda_cirurgica' and usuario='sistema:cron-v46';
  if logs <> 3 then raise exception '111: esperado 3 logs de auditoria, veio %', logs; end if;
  if has_function_privilege('anon','public.agenda_processar_liberacoes_v46()','execute') or has_function_privilege('authenticated','public.agenda_processar_liberacoes_v46()','execute')
    then raise exception '111: anon/authenticated não podem executar'; end if;
end $$;
\echo 'OK 111: libera confirmado e realizado vencidos; respeita prazo, quitação, ausência, cancelado e já liberado; idempotente; 1 log por liberação'

-- 3) Rollback: volta exatamente ao comportamento e à definição anteriores.
\ir ../rollback/migration_111_rollback.sql
select pg_temp.casos();
do $$ declare n int; src text; begin
  n := public.agenda_processar_liberacoes_v46();
  if n <> 1 or pg_temp.liberados() <> 'A_confirmado_vencido' then raise exception 'ROLLBACK: esperado só A, veio % (%)', n, pg_temp.liberados(); end if;
  select md5(prosrc) into src from pg_proc where proname='agenda_processar_liberacoes_v46';
  if src <> '7c963947ccc3d0f66cf4ea7778d10220' then raise exception 'ROLLBACK: corpo da função difere de produção (md5 %)', src; end if;
end $$;
\echo 'OK rollback: função idêntica à de produção (md5 do corpo) e índice só com confirmado'
