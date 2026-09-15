-- LGPD: indicação de terceira pessoa exige declaração explícita de autorização de contato.
begin;

alter table public.indicacoes_clientes
  add column if not exists consentimento_contato boolean not null default false,
  add column if not exists consentimento_registrado_em timestamptz;

alter table public.indicacoes_clientes
  drop constraint if exists indicacoes_clientes_consentimento_check;
alter table public.indicacoes_clientes
  add constraint indicacoes_clientes_consentimento_check
  check (consentimento_contato = true and consentimento_registrado_em is not null);

comment on column public.indicacoes_clientes.consentimento_contato is
  'Declaração da pessoa indicadora de que a pessoa indicada autorizou contato pela Sra. Luck.';
comment on column public.indicacoes_clientes.consentimento_registrado_em is
  'Instante em que a declaração de autorização de contato foi registrada.';

revoke all on public.indicacoes_clientes from anon, authenticated;
grant all on public.indicacoes_clientes to service_role;

commit;
