-- ==========================================================================
-- MIGRATION 027: Tema editável do painel administrativo
-- Data: 2026-09-11
--
-- Mantém as cores oficiais como padrão, mas permite que a administração
-- personalize a aparência do painel sem alterar código ou expor configuração
-- sensível no frontend.
-- ==========================================================================

alter table public.configuracoes
  add column if not exists tema_cor_primaria text not null default '#7A2632',
  add column if not exists tema_cor_secundaria text not null default '#B9787F',
  add column if not exists tema_cor_destaque text not null default '#A8834E';

-- Normaliza registros antigos ou valores inválidos antes de criar constraints.
update public.configuracoes
set
  tema_cor_primaria = case when tema_cor_primaria ~ '^#[0-9A-Fa-f]{6}$' then upper(tema_cor_primaria) else '#7A2632' end,
  tema_cor_secundaria = case when tema_cor_secundaria ~ '^#[0-9A-Fa-f]{6}$' then upper(tema_cor_secundaria) else '#B9787F' end,
  tema_cor_destaque = case when tema_cor_destaque ~ '^#[0-9A-Fa-f]{6}$' then upper(tema_cor_destaque) else '#A8834E' end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_configuracoes_tema_cor_primaria'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint chk_configuracoes_tema_cor_primaria
      check (tema_cor_primaria ~ '^#[0-9A-Fa-f]{6}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_configuracoes_tema_cor_secundaria'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint chk_configuracoes_tema_cor_secundaria
      check (tema_cor_secundaria ~ '^#[0-9A-Fa-f]{6}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_configuracoes_tema_cor_destaque'
      and conrelid = 'public.configuracoes'::regclass
  ) then
    alter table public.configuracoes
      add constraint chk_configuracoes_tema_cor_destaque
      check (tema_cor_destaque ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

comment on column public.configuracoes.tema_cor_primaria is
  'Cor principal hexadecimal do painel administrativo. Usada pela gestão; padrão oficial Sra. Luck.';
comment on column public.configuracoes.tema_cor_secundaria is
  'Cor secundária hexadecimal do painel administrativo. Usada pela gestão; padrão oficial Sra. Luck.';
comment on column public.configuracoes.tema_cor_destaque is
  'Cor de destaque hexadecimal do painel administrativo. Usada pela gestão; padrão oficial Sra. Luck.';
