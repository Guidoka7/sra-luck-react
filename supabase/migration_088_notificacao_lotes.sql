-- 088 — Central de Notificações: lotes financeiros com aprovação.
--
-- Um lote reúne as clientes que devem receber lembrete financeiro numa
-- rodada, com UMA mensagem por cliente (parcelas agrupadas). O lote nasce
-- PREPARED (nada enviado), recebe as mensagens do Gemini
-- (AWAITING_APPROVAL), é aprovado por uma pessoa e só então processado
-- pelo mesmo envio já existente (notificacoes_cliente + Web Push).
--
-- PROVIDER_ACCEPTED = o serviço de push aceitou (NÃO significa que a cliente viu).
-- IN_APP_ONLY = a notificação ficou no app, mas a cliente não tem aparelho com push.
-- OPENED/CLICKED só serão usados quando o app registrar esses eventos de verdade.
--
-- Não há cópia de clientes nem de parcelas: `parcelas` guarda só o recorte
-- que foi usado na mensagem (para auditoria do que foi dito).
--
-- Não destrutiva. Rollback: drop table public.notificacao_lote_itens; drop table public.notificacao_lotes;

create table if not exists public.notificacao_lotes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'financeiro' check (tipo in ('financeiro')),
  status text not null default 'PREPARED' check (status in (
    'PREPARED', 'AI_GENERATION_FAILED', 'AWAITING_APPROVAL', 'QUEUED_FOR_ALLOWED_WINDOW',
    'PROCESSING', 'COMPLETED', 'CANCELLED'
  )),
  data_referencia date not null,
  origem text not null default 'manual' check (origem in ('manual', 'rotina')),
  criado_por text not null,
  aprovado_por text,
  aprovado_em timestamptz,
  cancelado_por text,
  cancelado_em timestamptz,
  processamento_iniciado_em timestamptz,
  concluido_em timestamptz,
  prompt_version text,
  modelo text,
  instrucao text check (instrucao is null or char_length(instrucao) <= 300),
  erro text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notificacao_lotes_created_idx on public.notificacao_lotes (created_at desc);
create index if not exists notificacao_lotes_status_idx on public.notificacao_lotes (status);

create table if not exists public.notificacao_lote_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.notificacao_lotes(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  segmento text not null,
  parcelas jsonb not null default '[]'::jsonb,
  quantidade_parcelas integer not null default 0,
  valor_total numeric(12,2) not null default 0,
  maior_atraso integer not null default 0,
  titulo text check (titulo is null or char_length(titulo) <= 80),
  mensagem text check (mensagem is null or char_length(mensagem) <= 400),
  gerada_por text,
  gerada_em timestamptz,
  editada_por text,
  status text not null default 'PREPARED' check (status in (
    'PREPARED', 'AWAITING_APPROVAL', 'QUEUED', 'PROCESSING', 'PROVIDER_ACCEPTED', 'IN_APP_ONLY', 'FAILED',
    'SKIPPED_DEDUPLICATION', 'SKIPPED_RULE', 'OPENED', 'CLICKED', 'CANCELLED'
  )),
  motivo text,
  notificacao_id uuid,
  push_status text,
  processado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lote_id, cliente_id)
);

create index if not exists notificacao_lote_itens_lote_idx on public.notificacao_lote_itens (lote_id);
create index if not exists notificacao_lote_itens_cliente_idx on public.notificacao_lote_itens (cliente_id, created_at desc);

-- Somente o backend (service role) lê e grava.
alter table public.notificacao_lotes enable row level security;
alter table public.notificacao_lote_itens enable row level security;
revoke all on public.notificacao_lotes from anon, authenticated;
revoke all on public.notificacao_lote_itens from anon, authenticated;
