-- migration_113 — fila de pendências das integrações (RD Station primeiro).
--
-- Diagnóstico: docs/DIAGNOSTICO-RD-2026-09-28.md. Negociações com falha, ignoradas ou incompletas
-- não apareciam em nenhuma tela de conferência, e nenhuma venda incompleta era marcada.
--
-- O que cria (não destrutiva; não altera nem apaga dados existentes):
--   * integracao_pendencias: uma linha ABERTA por (provedor, tipo, external_id); repetição só soma
--     ocorrências. Fechada = resolvida (pela origem, por reprocessamento ou manual) ou descartada.
--   * colaborador_vinculos_externos: usuário do RD ↔ pessoa da equipe (vendedora/SDR), identificador estável.
--   * rd_recalcular_pendencias_venda(): ÚNICA implementação das regras de venda incompleta.
--   * rd_recalcular_pendencias_todas(): calcula a fila a partir das vendas existentes, sem reimportar.
--   * vw_vendas_validas_bi: o que o BI pode contar como venda válida.
--
-- Rollback: supabase/rollback/migration_113_rollback.sql (remove só o que esta migration cria).
-- Ordem: aplicar antes de promover o App que usa estas funções.

create table if not exists public.integracao_pendencias (
  id uuid primary key default gen_random_uuid(),
  provedor text not null check (provedor ~ '^[a-z_]{2,40}$'),
  tipo text not null check (tipo in (
    'execucao_falhou', 'execucao_interrompida', 'negociacao_com_erro', 'campos_ausentes',
    'vendedora_nao_vinculada', 'status_nao_ganha', 'ganha_fora_do_funil', 'duplicidade_possivel', 'excluida_no_rd'
  )),
  external_id text not null,
  importacao_id uuid references public.integracao_importacoes(id) on delete set null,
  nova_venda_id uuid references public.novas_vendas(id) on delete set null,
  origem text,
  motivo text not null,
  campos_faltantes text[] not null default '{}',
  acao_necessaria text not null,
  dados jsonb not null default '{}',
  estado text not null default 'aberta' check (estado in ('aberta', 'resolvida', 'descartada')),
  resolucao text check (resolucao is null or resolucao in ('resolvida_pela_origem', 'reprocessada', 'descartada', 'decidida_na_revisao')),
  nota text check (nota is null or char_length(nota) <= 500),
  ocorrencias integer not null default 1 check (ocorrencias >= 1),
  primeira_ocorrencia_em timestamptz not null default now(),
  ultima_ocorrencia_em timestamptz not null default now(),
  resolvido_por text,
  resolvido_em timestamptz,
  check ((estado = 'aberta') = (resolvido_em is null))
);

create unique index if not exists integracao_pendencias_aberta_unica
  on public.integracao_pendencias (provedor, tipo, external_id) where estado = 'aberta';
create index if not exists integracao_pendencias_fila_idx
  on public.integracao_pendencias (provedor, estado, ultima_ocorrencia_em desc);
create index if not exists integracao_pendencias_venda_idx
  on public.integracao_pendencias (nova_venda_id) where estado = 'aberta';

alter table public.integracao_pendencias enable row level security;
revoke all on table public.integracao_pendencias from anon, authenticated;
grant select, insert, update on table public.integracao_pendencias to service_role;

create table if not exists public.colaborador_vinculos_externos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null check (provedor ~ '^[a-z_]{2,40}$'),
  id_externo text not null check (char_length(btrim(id_externo)) > 0),
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  criado_por text not null,
  created_at timestamptz not null default now(),
  unique (provedor, id_externo)
);
alter table public.colaborador_vinculos_externos enable row level security;
revoke all on table public.colaborador_vinculos_externos from anon, authenticated;
grant select, insert, update, delete on table public.colaborador_vinculos_externos to service_role;

-- Abre ou soma ocorrência numa pendência aberta (idempotente por provedor+tipo+external_id).
create or replace function public.integracao_registrar_pendencia(
  p_provedor text, p_tipo text, p_external_id text, p_motivo text, p_acao text,
  p_campos text[] default '{}', p_origem text default null, p_importacao_id uuid default null,
  p_nova_venda_id uuid default null, p_dados jsonb default '{}', p_contar boolean default true
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  -- Descartada por uma pessoa (com motivo) não reabre sozinha a cada execução.
  if exists (select 1 from public.integracao_pendencias
             where provedor = p_provedor and tipo = p_tipo and external_id = p_external_id and estado = 'descartada') then
    return null;
  end if;
  insert into public.integracao_pendencias (provedor, tipo, external_id, motivo, acao_necessaria, campos_faltantes, origem, importacao_id, nova_venda_id, dados)
  values (p_provedor, p_tipo, p_external_id, p_motivo, p_acao, coalesce(p_campos, '{}'), p_origem, p_importacao_id, p_nova_venda_id, coalesce(p_dados, '{}'))
  on conflict (provedor, tipo, external_id) where estado = 'aberta' do update set
    -- Recalcular (p_contar = false) atualiza o motivo sem inflar a contagem de ocorrências.
    ocorrencias = public.integracao_pendencias.ocorrencias + case when p_contar then 1 else 0 end,
    ultima_ocorrencia_em = case when p_contar then now() else public.integracao_pendencias.ultima_ocorrencia_em end,
    motivo = excluded.motivo,
    acao_necessaria = excluded.acao_necessaria,
    campos_faltantes = excluded.campos_faltantes,
    origem = coalesce(excluded.origem, public.integracao_pendencias.origem),
    importacao_id = coalesce(excluded.importacao_id, public.integracao_pendencias.importacao_id),
    nova_venda_id = coalesce(excluded.nova_venda_id, public.integracao_pendencias.nova_venda_id),
    dados = excluded.dados
  returning id into v_id;
  return v_id;
end $$;

-- Fecha pendências abertas cuja causa sumiu.
create or replace function public.integracao_resolver_pendencias(
  p_provedor text, p_external_id text, p_tipos text[], p_ator text, p_resolucao text default 'resolvida_pela_origem'
) returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  update public.integracao_pendencias
  set estado = 'resolvida', resolucao = p_resolucao, resolvido_por = p_ator, resolvido_em = now()
  where provedor = p_provedor and external_id = p_external_id and estado = 'aberta' and tipo = any(p_tipos);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.rd_cpf_valido(p text) returns boolean
language sql immutable set search_path = public
as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') c),
  dig as (select c, array(select substr(c, i, 1)::int from generate_series(1, 11) i) a from d where length(c) = 11)
  select coalesce((
    select c !~ '^(\d)\1{10}$'
      and ((select sum(a[i] * (11 - i)) from generate_series(1, 9) i) * 10 % 11) % 10 = a[10]
      and ((select sum(a[i] * (12 - i)) from generate_series(1, 10) i) * 10 % 11) % 10 = a[11]
    from dig), false);
$$;

-- ÚNICA regra de venda incompleta. Usa os dados da cliente quando a venda já virou cadastro.
-- Resolve vendedora_id pelo vínculo estável (rd_owner_id), nunca pelo nome.
create or replace function public.rd_recalcular_pendencias_venda(
  p_venda_id uuid, p_origem text default null, p_importacao_id uuid default null, p_ator text default 'sistema:rd_pendencias'
) returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v public.novas_vendas%rowtype;
  c public.clientes%rowtype;
  v_cpf text; v_valor numeric; v_parcelas integer;
  v_campos text[] := '{}';
  v_abertas text[] := '{}';
  v_colab uuid;
  v_dados jsonb;
begin
  select * into v from public.novas_vendas where id = p_venda_id for update;
  if not found then return '{}'; end if;
  if v.cliente_id is not null then select * into c from public.clientes where id = v.cliente_id; end if;

  if v.vendedora_id is null and v.rd_owner_id is not null then
    select colaborador_id into v_colab from public.colaborador_vinculos_externos where provedor = 'rd_station' and id_externo = v.rd_owner_id;
    if v_colab is not null then
      update public.novas_vendas set vendedora_id = v_colab, updated_at = now() where id = v.id;
      v.vendedora_id := v_colab;
    end if;
  end if;

  v_cpf := coalesce(c.cpf, v.cpf);
  v_valor := coalesce(c.valor_contrato, v.valor_contrato);
  v_parcelas := coalesce(c.quantidade_parcelas, v.quantidade_parcelas);
  if not public.rd_cpf_valido(v_cpf) then v_campos := array_append(v_campos, 'cpf'); end if;
  if coalesce(v_valor, 0) <= 0 then v_campos := array_append(v_campos, 'valor_contrato'); end if;
  if coalesce(v_parcelas, 0) <= 0 then v_campos := array_append(v_campos, 'quantidade_parcelas'); end if;

  -- Sem dados pessoais na fila: só identificadores técnicos e o que falta.
  v_dados := jsonb_build_object('rd_status', v.rd_status, 'status_venda', v.status, 'tem_cliente', v.cliente_id is not null);

  if v.rd_excluido_em is not null or v.rd_status = 'deleted' then
    perform public.integracao_registrar_pendencia('rd_station', 'excluida_no_rd', v.rd_station_id,
      'A negociação foi excluída no RD Station.', 'Conferir e descartar a venda se não houver cliente.', '{}', p_origem, p_importacao_id, v.id, v_dados, false);
    v_abertas := array_append(v_abertas, 'excluida_no_rd');
  end if;
  if cardinality(v_campos) > 0 then
    perform public.integracao_registrar_pendencia('rd_station', 'campos_ausentes', v.rd_station_id,
      'Venda sem ' || array_to_string(v_campos, ', ') || '.', 'Completar no cadastro da cliente e reprocessar.', v_campos, p_origem, p_importacao_id, v.id, v_dados, false);
    v_abertas := array_append(v_abertas, 'campos_ausentes');
  end if;
  if v.vendedora_id is null then
    perform public.integracao_registrar_pendencia('rd_station', 'vendedora_nao_vinculada', v.rd_station_id,
      case when v.rd_owner_id is null then 'Negociação sem responsável no RD.' else 'Responsável do RD sem vínculo com a equipe.' end,
      'Vincular o responsável do RD à vendedora em Admin › Clientes › Importações do RD (fecha sozinha).', '{}', p_origem, p_importacao_id, v.id,
      v_dados || jsonb_build_object('rd_owner_id', v.rd_owner_id), false);
    v_abertas := array_append(v_abertas, 'vendedora_nao_vinculada');
  end if;
  if coalesce(v.rd_status, '') not in ('won', 'deleted') then
    perform public.integracao_registrar_pendencia('rd_station', 'status_nao_ganha', v.rd_station_id,
      'A negociação está "' || coalesce(v.rd_status, 'sem status') || '" no RD, não ganha.', 'Confirmar a venda ou descartar.', '{}', p_origem, p_importacao_id, v.id, v_dados, false);
    v_abertas := array_append(v_abertas, 'status_nao_ganha');
  end if;

  -- Fecha o que deixou de valer (inclusive erro/fora do funil, já que a venda existe).
  perform public.integracao_resolver_pendencias('rd_station', v.rd_station_id,
    array(select t from unnest(array['campos_ausentes','vendedora_nao_vinculada','status_nao_ganha','excluida_no_rd','negociacao_com_erro','ganha_fora_do_funil']) t where t <> all(v_abertas)),
    p_ator);
  return v_abertas;
end $$;

create or replace function public.rd_recalcular_pendencias_todas(p_ator text default 'sistema:rd_pendencias') returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in select id from public.novas_vendas where rd_station_id is not null order by created_at loop
    perform public.rd_recalcular_pendencias_venda(r.id, 'recalculo', null, p_ator);
    n := n + 1;
  end loop;
  return jsonb_build_object('vendas', n, 'abertas', (select jsonb_object_agg(tipo, q) from (select tipo, count(*) q from public.integracao_pendencias where provedor = 'rd_station' and estado = 'aberta' group by 1) x));
end $$;

-- Venda válida para o BI: ganha, com vendedora vinculada, dados completos e nenhuma pendência aberta.
create or replace view public.vw_vendas_validas_bi with (security_invoker = on) as
select v.id, v.rd_station_id, v.cliente_id, v.vendedora_id, v.data_venda,
       coalesce(c.valor_contrato, v.valor_contrato) as valor_contrato
from public.novas_vendas v
left join public.clientes c on c.id = v.cliente_id
where v.rd_status = 'won' and v.rd_excluido_em is null and v.vendedora_id is not null
  and public.rd_cpf_valido(coalesce(c.cpf, v.cpf))
  and coalesce(c.valor_contrato, v.valor_contrato, 0) > 0
  and not exists (select 1 from public.integracao_pendencias p where p.nova_venda_id = v.id and p.estado = 'aberta');
revoke all on public.vw_vendas_validas_bi from anon, authenticated;
grant select on public.vw_vendas_validas_bi to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'integracao_registrar_pendencia(text,text,text,text,text,text[],text,uuid,uuid,jsonb,boolean)',
    'integracao_resolver_pendencias(text,text,text[],text,text)',
    'rd_recalcular_pendencias_venda(uuid,text,uuid,text)',
    'rd_recalcular_pendencias_todas(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
