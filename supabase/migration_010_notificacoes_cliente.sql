-- ============================================================================
-- MIGRATION 010: Central de notificações da cliente (Agenda/Previsão)
-- Execute no SQL Editor do Supabase.
--
-- Tabela enxuta e dedicada à central de notificações DENTRO do app da
-- cliente (sino no cabeçalho, contador de não lidas, clique leva para a
-- tela relacionada). É separada das tabelas de push/cron da migration 006
-- (notificacao_agendadas / notificacao_logs), que servem a outro sistema
-- (um backend externo de disparo agendado) e têm um formato diferente.
-- ============================================================================

create table if not exists notificacoes_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null, -- 'previsao_criada' | 'previsao_atualizada'
  titulo text not null,
  mensagem text not null,
  emoji text default '🔔',
  destino text default 'agenda', -- tela para onde a notificação leva ao ser clicada
  referencia_id uuid, -- id do agendamento relacionado, quando aplicável
  lida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notificacoes_cliente_cliente_id on notificacoes_cliente(cliente_id);
create index if not exists idx_notificacoes_cliente_lida on notificacoes_cliente(cliente_id, lida);
create index if not exists idx_notificacoes_cliente_created_at on notificacoes_cliente(created_at desc);

alter table notificacoes_cliente enable row level security;

-- A cliente final não usa Supabase Auth (login por CPF + data de nascimento
-- via API route com service_role — ver src/lib/session.ts), então, como o
-- resto do schema, o acesso do lado da cliente sempre passa pela API do
-- Next.js com service_role. Só o admin autenticado tem acesso direto via RLS.
create policy "admin_full_access_notificacoes_cliente" on notificacoes_cliente
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

select 'Tabela notificacoes_cliente criada com sucesso!' as mensagem;
