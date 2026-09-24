-- Compatibilidade LGPD das indicações do Clube.
-- Produção já possui esta regra via migration histórica lgpd_consentimento_indicacoes.
-- Este arquivo fecha o drift do repositório e mantém novos ambientes equivalentes.

alter table public.indicacoes_clientes
  add column if not exists consentimento_contato boolean not null default false,
  add column if not exists consentimento_registrado_em timestamptz;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'indicacoes_clientes_consentimento_check'
       and conrelid = 'public.indicacoes_clientes'::regclass
  ) then
    alter table public.indicacoes_clientes
      add constraint indicacoes_clientes_consentimento_check
      check (consentimento_contato = true and consentimento_registrado_em is not null)
      not valid;
  end if;
end $$;

comment on column public.indicacoes_clientes.consentimento_contato
  is 'Confirmação explícita de que a cliente indicadora declarou autorização para compartilhar o contato.';
comment on column public.indicacoes_clientes.consentimento_registrado_em
  is 'Momento em que a confirmação de consentimento do contato foi registrada.';
