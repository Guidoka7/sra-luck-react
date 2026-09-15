-- Security/LGPD hardening — runtime canônico: Cloudflare Worker + service_role.
-- O browser não acessa dados de negócio diretamente no schema public.

begin;

-- 1) Menor privilégio: nenhuma tabela/view/sequence/função de negócio fica
-- acessível diretamente pelos papéis públicos do PostgREST.
revoke all on schema public from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- 2) Remove políticas históricas que permitiam bypass direto via token Supabase.
-- RLS permanece habilitado; service_role é o único canal da aplicação.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

do $$
declare t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p')
  loop
    execute format('alter table %I.%I enable row level security', t.schema_name, t.table_name);
  end loop;
end $$;

-- 3) Elimina RPC legada de autenticação por CPF+nascimento que era SECURITY DEFINER.
drop function if exists public.verificar_login_cliente(text, date);

-- 4) Cirurgia: data_cirurgia é a fonte de verdade. 90 dias é teto máximo,
-- nunca espera mínima. A data precisa estar >= base/today e <= limite.
create or replace function public.agendar_cirurgia_data(p_agendamento_id uuid, p_data date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agendamento public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_data public.datas_liberacao_financeira%rowtype;
  v_ocupadas integer;
  v_base date;
  v_limite date;
  v_hoje date := (timezone('America/Sao_Paulo', now()))::date;
begin
  select * into v_agendamento
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found then
    raise exception using errcode = 'P0012', message = 'AGENDAMENTO_NAO_ENCONTRADO';
  end if;
  if v_agendamento.termos_assinados_em is null then
    raise exception using errcode = 'P0013', message = 'TERMOS_NAO_ASSINADOS';
  end if;

  select * into v_cliente
  from public.clientes
  where id = v_agendamento.cliente_id
  for update;

  if not found then
    raise exception using errcode = 'P0014', message = 'CLIENTE_NAO_ENCONTRADA';
  end if;
  if v_cliente.custeio_confirmado_em is null then
    raise exception using errcode = 'P0015', message = 'SALDO_NAO_QUITADO';
  end if;

  v_base := greatest(
    (timezone('America/Sao_Paulo', v_agendamento.termos_assinados_em))::date,
    (timezone('America/Sao_Paulo', v_cliente.custeio_confirmado_em))::date
  );
  v_limite := public.adicionar_dias_corridos(v_base, 90);

  if p_data < greatest(v_base, v_hoje) then
    raise exception using errcode = 'P0017', message = 'DATA_CIRURGIA_ANTES_DA_BASE';
  end if;
  if p_data > v_limite then
    raise exception using errcode = 'P0016', message = 'PRAZO_CIRURGICO_EXCEDIDO';
  end if;

  select * into v_data
  from public.datas_liberacao_financeira
  where data = p_data
  for update;
  if not found or v_data.status <> 'disponivel' then
    raise exception using errcode = 'P0010', message = 'DATA_CIRURGIA_INDISPONIVEL';
  end if;

  select count(*)::integer into v_ocupadas
  from public.agendamentos
  where status in ('confirmado', 'realizado')
    and data_cirurgia = p_data
    and id <> p_agendamento_id;
  if v_ocupadas >= 1 then
    raise exception using errcode = 'P0011', message = 'DATA_CIRURGIA_OCUPADA';
  end if;

  update public.agendamentos
  set data_cirurgia = p_data,
      -- Compatibilidade temporária de leitura com telas legadas. Nunca mais usar
      -- este campo como fonte de verdade nem para ocupação.
      previsao_liberacao_financeira = p_data,
      updated_at = now()
  where id = p_agendamento_id;

  update public.clientes
  set status_cirurgia = 'agendada', updated_at = now()
  where id = v_agendamento.cliente_id;
end;
$$;
revoke execute on function public.agendar_cirurgia_data(uuid,date) from public, anon, authenticated;
grant execute on function public.agendar_cirurgia_data(uuid,date) to service_role;

-- 5) Bucket financeiro privado, com limites no próprio Storage além da
-- validação de magic bytes no Worker.
update storage.buckets
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']::text[]
where id = 'boletos-clientes';

-- 6) Minimização retroativa de auditoria: nomes/CPF/e-mail/telefone não são
-- necessários para provar a ação quando entidade_id/cliente_id já identificam o registro.
update public.logs_alteracoes
set detalhes = coalesce(detalhes, '{}'::jsonb)
  - 'cliente' - 'nome' - 'nomeCliente' - 'cpf' - 'email' - 'telefone' - 'data_nascimento'
where detalhes ?| array['cliente','nome','nomeCliente','cpf','email','telefone','data_nascimento'];

-- 7) Payloads de provedores não podem virar um lago de PII. Os eventos novos
-- já chegam allowlisted; esta limpeza reduz qualquer legado que possa existir.
update public.pagamentos_externos
set payload = jsonb_strip_nulls(jsonb_build_object(
  'id', payload->'id',
  'status', payload->'status',
  'status_detail', payload->'status_detail',
  'transaction_amount', payload->'transaction_amount',
  'currency_id', payload->'currency_id',
  'date_created', payload->'date_created',
  'date_approved', payload->'date_approved',
  'payment_method_id', payload->'payment_method_id',
  'payment_type_id', payload->'payment_type_id',
  'external_reference', payload->'external_reference',
  'metadata', case when payload ? 'metadata' then jsonb_build_object('boleto_id', payload#>'{metadata,boleto_id}') else null end
))
where provedor = 'mercado_pago' and payload is not null;

update public.integracao_eventos
set payload = jsonb_strip_nulls(jsonb_build_object(
  'id', payload->'id',
  'status', payload->'status',
  'status_detail', payload->'status_detail',
  'transaction_amount', payload->'transaction_amount',
  'currency_id', payload->'currency_id',
  'date_created', payload->'date_created',
  'date_approved', payload->'date_approved',
  'payment_method_id', payload->'payment_method_id',
  'payment_type_id', payload->'payment_type_id',
  'external_reference', payload->'external_reference',
  'metadata', case when payload ? 'metadata' then jsonb_build_object('boleto_id', payload#>'{metadata,boleto_id}') else null end
))
where provedor = 'mercado_pago' and payload is not null;

-- 8) Retenção de telemetria técnica. Não apaga auditoria/financeiro, que seguem
-- a retenção legal/contratual aplicável.
create or replace function public.lgpd_limpar_dados_tecnicos()
returns table(rate_limits_removidos bigint, monitoramento_removido bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate bigint;
  v_monitor bigint;
begin
  delete from public.login_rate_limits where updated_at < now() - interval '7 days';
  get diagnostics v_rate = row_count;
  delete from public.monitoramento_erros where criado_em < now() - interval '90 days';
  get diagnostics v_monitor = row_count;
  return query select v_rate, v_monitor;
end;
$$;
revoke execute on function public.lgpd_limpar_dados_tecnicos() from public, anon, authenticated;
grant execute on function public.lgpd_limpar_dados_tecnicos() to service_role;

-- Reaplica a regra de execução depois de criar/substituir funções nesta migration.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

commit;
