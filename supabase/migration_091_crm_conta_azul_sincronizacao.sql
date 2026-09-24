-- 091 — CRM configurável e sincronização Conta Azul.
--
-- CRM (RD Station, somente leitura no RD):
--   integracao_importacoes / integracao_importacao_itens: histórico de cada importação
--   (manual, agendada ou webhook) e o destino de cada negociação: criada em
--   "Aguardando cadastro", atualizada (só o snapshot rd_*), duplicada, cliente já
--   existente, ignorada ou erro. Duplicidades NÃO viram venda nova: ficam no histórico
--   para revisão humana ("importar mesmo assim").
--   novas_vendas avança para financeiro_concluido sozinha somente quando a cliente
--   vinculada tem parcelas cadastradas E acesso ao app liberado (gatilho abaixo).
--
-- Conta Azul (API v2):
--   conta_azul_vinculos: vínculo permanente parcela Sra Luck ↔ parcela/evento Conta Azul,
--   com o último estado sincronizado de cada lado (base da detecção de conflito).
--   integracao_fila: operações com retentativa e chave de idempotência.
--   integracao_conflitos: fila de revisão; nada em conflito é sobrescrito sozinho.
--   integracao_travas / integracao_cursores: exclusão mútua (renovação de token,
--   sincronização) e posição da leitura incremental de /alteracoes.
--   Agendamento a cada 15 min por pg_cron + pg_net, chamando /api/cron/integracoes com
--   segredos guardados no Vault (sem segredo neste arquivo). Sem os segredos, não faz nada.
--
-- Não destrutiva, exceto o avanço de vendas já elegíveis (bloco "Retroativo").
-- Rollback:
--   select cron.unschedule('integracoes-sync-15min');
--   drop function public.integracoes_disparar_sync(); drop function public.integracao_tentar_trava(text, integer);
--   drop function public.integracao_liberar_trava(text);
--   drop trigger trg_novas_vendas_avancar on public.clientes; drop function public.novas_vendas_avancar_concluidas();
--   drop table public.integracao_conflitos, public.integracao_fila, public.conta_azul_vinculos,
--     public.integracao_importacao_itens, public.integracao_importacoes, public.integracao_travas, public.integracao_cursores;
--   alter table public.novas_vendas drop column importacao_id;

-- ---------------------------------------------------------------------------
-- CRM: histórico de importações
-- ---------------------------------------------------------------------------
create table if not exists public.integracao_importacoes (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  origem text not null check (origem in ('manual','agendada','webhook')),
  status text not null default 'em_andamento' check (status in ('em_andamento','concluida','parcial','erro')),
  filtro text,
  totais jsonb not null default '{}'::jsonb,
  erro text,
  iniciado_por text,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index if not exists integracao_importacoes_provedor_idx on public.integracao_importacoes(provedor, iniciado_em desc);

create table if not exists public.integracao_importacao_itens (
  id uuid primary key default gen_random_uuid(),
  importacao_id uuid not null references public.integracao_importacoes(id) on delete cascade,
  external_id text not null,
  resultado text not null check (resultado in ('criada','atualizada','duplicada','cliente_existente','ignorada','erro','importada_apos_revisao')),
  motivo text,
  correspondencias jsonb not null default '[]'::jsonb,
  nova_venda_id uuid references public.novas_vendas(id) on delete set null,
  dados jsonb not null default '{}'::jsonb,
  revisado_por text,
  revisado_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists integracao_importacao_itens_imp_idx on public.integracao_importacao_itens(importacao_id);
create index if not exists integracao_importacao_itens_revisao_idx on public.integracao_importacao_itens(resultado, created_at desc)
  where resultado in ('duplicada','cliente_existente');

alter table public.novas_vendas add column if not exists importacao_id uuid references public.integracao_importacoes(id) on delete set null;

-- Avanço automático: somente com cadastro financeiro (parcelas) E acesso ao app liberado.
create or replace function public.novas_vendas_avancar_concluidas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.acesso_app_liberado is true and (old.acesso_app_liberado is distinct from true) then
    update public.novas_vendas v
       set status = 'financeiro_concluido', updated_at = now()
     where v.cliente_id = new.id
       and v.status = 'aguardando_boletos'
       and exists (select 1 from public.boletos b where b.cliente_id = new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_novas_vendas_avancar on public.clientes;
create trigger trg_novas_vendas_avancar
  after update of acesso_app_liberado on public.clientes
  for each row execute function public.novas_vendas_avancar_concluidas();

-- Retroativo: vendas que já cumprem as duas condições.
update public.novas_vendas v
   set status = 'financeiro_concluido', updated_at = now()
  from public.clientes c
 where v.cliente_id = c.id
   and v.status = 'aguardando_boletos'
   and c.acesso_app_liberado is true
   and exists (select 1 from public.boletos b where b.cliente_id = c.id);

-- ---------------------------------------------------------------------------
-- Conta Azul: vínculos, fila e conflitos
-- ---------------------------------------------------------------------------
create table if not exists public.conta_azul_vinculos (
  id uuid primary key default gen_random_uuid(),
  -- restrict: parcela vinculada não pode sumir do Sra Luck sem resolver o vínculo.
  boleto_id uuid not null unique references public.boletos(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  marcador text not null unique,
  estado text not null default 'aguardando_criacao' check (estado in (
    'aguardando_criacao','enviando','aguardando_protocolo','vinculado','conflito','erro_criacao','desvinculado')),
  ca_contato_id text,
  ca_evento_id text,
  ca_parcela_id text unique,
  ca_versao integer,
  protocolo text,
  enviado_em timestamptz,
  sra_snapshot jsonb not null default '{}'::jsonb,
  ca_snapshot jsonb not null default '{}'::jsonb,
  ca_baixa_id text,
  baixa_origem text check (baixa_origem in ('sra','conta_azul')),
  ultima_sincronizacao_em timestamptz,
  ultimo_erro text,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conta_azul_vinculos_estado_idx on public.conta_azul_vinculos(estado);
create index if not exists conta_azul_vinculos_evento_idx on public.conta_azul_vinculos(ca_evento_id);
create index if not exists conta_azul_vinculos_verificacao_idx on public.conta_azul_vinculos(ultima_sincronizacao_em nulls first);

create table if not exists public.integracao_fila (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  operacao text not null,
  referencia uuid,
  payload jsonb not null default '{}'::jsonb,
  estado text not null default 'pendente' check (estado in ('pendente','processando','concluida','erro','cancelada')),
  tentativas integer not null default 0,
  max_tentativas integer not null default 6,
  proxima_tentativa_em timestamptz not null default now(),
  ultimo_erro text,
  chave_idempotencia text not null unique,
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  concluida_em timestamptz
);
create index if not exists integracao_fila_pendentes_idx on public.integracao_fila(provedor, estado, proxima_tentativa_em);

create table if not exists public.integracao_conflitos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  referencia uuid,
  vinculo_id uuid references public.conta_azul_vinculos(id) on delete set null,
  tipo text not null,
  descricao text not null,
  dados_sra jsonb not null default '{}'::jsonb,
  dados_externos jsonb not null default '{}'::jsonb,
  estado text not null default 'aberto' check (estado in ('aberto','resolvido','descartado')),
  resolucao text,
  nota text,
  resolvido_por text,
  resolvido_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists integracao_conflitos_aberto_uniq
  on public.integracao_conflitos(provedor, referencia, tipo) where estado = 'aberto';
create index if not exists integracao_conflitos_estado_idx on public.integracao_conflitos(provedor, estado, created_at desc);

create table if not exists public.integracao_travas (
  nome text primary key,
  ate timestamptz not null
);

create table if not exists public.integracao_cursores (
  provedor text not null,
  nome text not null,
  valor timestamptz not null,
  atualizado_em timestamptz not null default now(),
  primary key (provedor, nome)
);

-- Trava com expiração: devolve true só para quem conseguiu.
create or replace function public.integracao_tentar_trava(p_nome text, p_segundos integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  insert into public.integracao_travas(nome, ate) values (p_nome, now() + make_interval(secs => p_segundos))
  on conflict (nome) do update set ate = excluded.ate where public.integracao_travas.ate < now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.integracao_liberar_trava(p_nome text)
returns void
language sql
security definer
set search_path = public
as $$ delete from public.integracao_travas where nome = p_nome; $$;

alter table public.integracao_importacoes enable row level security;
alter table public.integracao_importacao_itens enable row level security;
alter table public.conta_azul_vinculos enable row level security;
alter table public.integracao_fila enable row level security;
alter table public.integracao_conflitos enable row level security;
alter table public.integracao_travas enable row level security;
alter table public.integracao_cursores enable row level security;
revoke all on public.integracao_importacoes, public.integracao_importacao_itens, public.conta_azul_vinculos,
  public.integracao_fila, public.integracao_conflitos, public.integracao_travas, public.integracao_cursores from anon, authenticated;
revoke all on function public.integracao_tentar_trava(text, integer) from public, anon, authenticated;
revoke all on function public.integracao_liberar_trava(text) from public, anon, authenticated;
revoke all on function public.novas_vendas_avancar_concluidas() from public, anon, authenticated;
grant execute on function public.integracao_tentar_trava(text, integer) to service_role;
grant execute on function public.integracao_liberar_trava(text) to service_role;

-- ---------------------------------------------------------------------------
-- Agendamento: a cada 15 min chama /api/cron/integracoes. A própria rota decide o que
-- está ligado (CRM na frequência configurada; Conta Azul a cada chamada).
-- Segredos no Vault (configurar por último):
--   select vault.create_secret('https://SEU-DOMINIO', 'sra_luck_app_url');
--   select vault.create_secret('<mesmo valor de CRON_SECRET>', 'sra_luck_cron_secret');
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function public.integracoes_disparar_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_segredo text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sra_luck_app_url';
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'sra_luck_cron_secret';
  if v_url is null or v_segredo is null or v_url !~ '^https://' then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/integracoes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function public.integracoes_disparar_sync() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('integracoes-sync-15min');
exception when others then null; end $$;
select cron.schedule('integracoes-sync-15min', '*/15 * * * *', 'select public.integracoes_disparar_sync();');
