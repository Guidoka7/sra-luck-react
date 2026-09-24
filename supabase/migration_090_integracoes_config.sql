-- 090 — Padrão de integrações: configuração por função e contador de uso.
--
-- integracoes_config: configuração operacional (NÃO secreta) por provedor e função,
-- com versão para edição concorrente segura. Segredos continuam só em
-- integracoes_credenciais (cifrados). Sem linha = comportamento padrão do código.
--
-- integracao_uso: chamadas por provedor/função/dia (data de Brasília), usado para
-- os limites diários configurados. integracao_consumir_uso() reserva uma chamada de
-- forma atômica e recusa quando o limite do dia já foi atingido.
--
-- Não destrutiva. Rollback:
--   drop function public.integracao_consumir_uso(text, text, date, integer);
--   drop table public.integracao_uso; drop table public.integracoes_config;

create table if not exists public.integracoes_config (
  provedor text not null check (provedor ~ '^[a-z0-9_]{2,40}$'),
  funcao text not null check (funcao ~ '^[a-z0-9_]{2,40}$'),
  config jsonb not null default '{}'::jsonb,
  versao integer not null default 1,
  atualizado_por text,
  atualizado_em timestamptz not null default now(),
  primary key (provedor, funcao)
);

create table if not exists public.integracao_uso (
  provedor text not null,
  funcao text not null,
  dia date not null,
  chamadas integer not null default 0,
  primary key (provedor, funcao, dia)
);

create or replace function public.integracao_consumir_uso(p_provedor text, p_funcao text, p_dia date, p_limite integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  insert into public.integracao_uso (provedor, funcao, dia, chamadas)
  values (p_provedor, p_funcao, p_dia, 1)
  on conflict (provedor, funcao, dia) do update
    set chamadas = public.integracao_uso.chamadas + 1
    where p_limite is null or public.integracao_uso.chamadas < p_limite
  returning chamadas into v_total;
  -- Sem linha retornada: o limite do dia já tinha sido atingido.
  return coalesce(v_total, -1);
end;
$$;

alter table public.integracoes_config enable row level security;
alter table public.integracao_uso enable row level security;
revoke all on public.integracoes_config from anon, authenticated;
revoke all on public.integracao_uso from anon, authenticated;
revoke all on function public.integracao_consumir_uso(text, text, date, integer) from public, anon, authenticated;
grant execute on function public.integracao_consumir_uso(text, text, date, integer) to service_role;
