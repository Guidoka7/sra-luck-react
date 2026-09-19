-- migration_057_clientes_origem_rd_station.sql
-- Consolida a entrada de clientes do RD Station como cadastro local real,
-- preservando o CRM como fonte externa somente de leitura.
--
-- Regras:
--   * novos negócios ganhos podem criar/vincular clientes locais imediatamente;
--   * sincronizações posteriores atualizam apenas snapshot/metadados externos;
--   * campos operacionais editados no Sra. Luck não são sobrescritos pelo RD;
--   * campos ausentes no CRM permanecem NULL, sem dados fictícios.

alter table public.clientes
  add column if not exists origem_cadastro text,
  add column if not exists crm_importado_em timestamptz,
  add column if not exists crm_ultimo_recebido_em timestamptz;

alter table public.clientes
  alter column origem_cadastro set default 'manual';

update public.clientes
set origem_cadastro = 'manual'
where origem_cadastro is null;

alter table public.clientes
  alter column origem_cadastro set not null;

do $$ begin
  alter table public.clientes
    add constraint clientes_origem_cadastro_chk
    check (origem_cadastro in ('manual', 'rd_station'));
exception when duplicate_object then null; end $$;

alter table public.novas_vendas
  alter column nome_completo drop not null,
  alter column valor_contrato drop not null,
  alter column valor_contrato drop default;

alter table public.novas_vendas
  add column if not exists procedimento_local text,
  add column if not exists banco_local text,
  add column if not exists rd_procedimento_original text,
  add column if not exists rd_banco_original text;

update public.clientes c
set
  origem_cadastro = case
    when c.origem_cadastro = 'manual' then 'rd_station'
    else c.origem_cadastro
  end,
  crm_importado_em = coalesce(c.crm_importado_em, v.created_at),
  crm_ultimo_recebido_em = greatest(
    coalesce(c.crm_ultimo_recebido_em, '-infinity'::timestamptz),
    coalesce(v.sincronizado_rd_em, v.updated_at, v.created_at)
  )
from public.novas_vendas v
where v.cliente_id = c.id;

comment on column public.clientes.origem_cadastro is
  'Origem do cadastro local. RD Station é somente entrada; edições locais nunca são escritas de volta no CRM.';
comment on column public.clientes.crm_importado_em is
  'Primeiro vínculo/importação conhecida a partir do CRM.';
comment on column public.clientes.crm_ultimo_recebido_em is
  'Último recebimento de snapshot do CRM. Não implica sobrescrita de campos operacionais locais.';
comment on column public.novas_vendas.procedimento_local is
  'Procedimento/interesse operacional recebido inicialmente do RD e editável somente no Sra. Luck.';
comment on column public.novas_vendas.banco_local is
  'Banco operacional recebido inicialmente do RD e editável somente no Sra. Luck.';
comment on column public.novas_vendas.rd_procedimento_original is
  'Último procedimento/interesse recebido do RD Station. Snapshot externo somente leitura.';
comment on column public.novas_vendas.rd_banco_original is
  'Último banco recebido do RD Station. Snapshot externo somente leitura.';
