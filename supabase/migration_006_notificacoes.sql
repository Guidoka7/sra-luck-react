-- ============================================================================
-- MIGRATION 006: Sistema de Notificações
-- Execute no SQL Editor do Supabase (projeto AGENDA - pzrtimomcjoivritvxom)
--
-- Adaptado ao schema real do projeto (clientes / datas / agendamentos / boletos).
-- A versão original que veio no pacote de notificações assumia colunas que não
-- existem aqui (clientes.user_id, clientes.agendada, tabela "boletos" com nomes
-- diferentes) — este arquivo já corrige tudo isso.
-- ============================================================================

-- ============ TABELA: PUSH TOKENS ============
-- Guarda o token de notificação push de cada cliente (se/quando você tiver
-- um app ou PWA capaz de registrar push). Por enquanto fica pronta para uso.
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  token text not null unique,
  device_name text,
  is_active boolean default true,
  created_at timestamptz default now(),
  last_used timestamptz,
  unique(cliente_id, token)
);

create index if not exists idx_push_tokens_cliente_id on push_tokens(cliente_id);

alter table push_tokens enable row level security;

-- A cliente final não usa Supabase Auth (login é CPF + data de nascimento via
-- API route com service_role — ver src/lib/session.ts). Por isso, assim como
-- o resto do schema, só o admin autenticado tem acesso direto; leitura/escrita
-- do lado da cliente sempre passa pela API do Next.js com service_role.
create policy "admin_full_access_push_tokens" on push_tokens
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ TABELA: NOTIFICACAO TEMPLATES ============
create table if not exists notificacao_templates (
  id uuid primary key default gen_random_uuid(),
  tipo text not null, -- 'assinatura', 'parcela_vencer', 'parcela_atrasada', 'manual'
  dias_referencia int, -- dias antes/depois do evento (5, 1, 0, -1, -2...)
  titulo text not null,
  corpo text not null,
  emoji text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table notificacao_templates enable row level security;

create policy "admin_full_access_notificacao_templates" on notificacao_templates
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ TABELA: NOTIFICACAO AGENDADAS ============
create table if not exists notificacao_agendadas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null, -- 'assinatura', 'parcela', 'atraso', 'manual'
  referencia_id uuid, -- id do boleto ou do agendamento relacionado
  titulo text,
  corpo text,
  emoji text,
  data_envio timestamptz,
  status text default 'pendente', -- 'pendente', 'enviada', 'falha', 'aberta'
  tentativas int default 0,
  erro_mensagem text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_notificacao_agendadas_cliente_id on notificacao_agendadas(cliente_id);
create index if not exists idx_notificacao_agendadas_status on notificacao_agendadas(status);
create index if not exists idx_notificacao_agendadas_created_at on notificacao_agendadas(created_at);
create index if not exists idx_notificacao_agendadas_referencia on notificacao_agendadas(referencia_id);

alter table notificacao_agendadas enable row level security;

create policy "admin_full_access_notificacao_agendadas" on notificacao_agendadas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ TABELA: NOTIFICACAO LOGS ============
create table if not exists notificacao_logs (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  notificacao_id uuid references notificacao_agendadas(id),
  tipo text not null,
  titulo text,
  corpo text,
  status text default 'enviada', -- 'enviada', 'aberta', 'erro'
  push_token text,
  erro_mensagem text,
  opened_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_notificacao_logs_cliente_id on notificacao_logs(cliente_id);

alter table notificacao_logs enable row level security;

create policy "admin_full_access_notificacao_logs" on notificacao_logs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============ TABELA: CONFIG DE NOTIFICAÇÕES ============
create table if not exists notificacoes_config (
  id uuid primary key default gen_random_uuid(),
  chave text unique not null,
  valor text,
  tipo text, -- 'boolean', 'number', 'text'
  descricao text,
  updated_at timestamptz default now()
);

alter table notificacoes_config enable row level security;

create policy "admin_full_access_notificacoes_config" on notificacoes_config
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into notificacoes_config (chave, valor, tipo, descricao) values
  ('assinatura_habilitada', 'true', 'boolean', 'Enviar notificações de assinatura (agendamento)'),
  ('parcela_habilitada', 'true', 'boolean', 'Enviar notificações de parcela a vencer'),
  ('atraso_habilitado', 'true', 'boolean', 'Enviar notificações de atraso'),
  ('frequencia_atraso_horas', '24', 'number', 'Frequência de notificações de atraso (horas)'),
  ('max_tentativas', '3', 'number', 'Máximo de tentativas de envio')
on conflict (chave) do nothing;

-- ============ TRIGGERS: updated_at automático ============
drop trigger if exists trg_notificacao_templates_updated_at on notificacao_templates;
create trigger trg_notificacao_templates_updated_at before update on notificacao_templates
  for each row execute function set_updated_at();

drop trigger if exists trg_notificacao_agendadas_updated_at on notificacao_agendadas;
create trigger trg_notificacao_agendadas_updated_at before update on notificacao_agendadas
  for each row execute function set_updated_at();

-- ============ VIEW: RESUMO NOTIFICAÇÕES ============
create or replace view vw_notificacoes_resumo as
select
  date(created_at) as data,
  tipo,
  count(*) as total,
  count(*) filter (where status = 'enviada') as enviadas,
  count(*) filter (where status = 'falha') as falhas,
  round(count(*) filter (where status = 'enviada')::numeric / nullif(count(*), 0) * 100, 1) as taxa_sucesso
from notificacao_agendadas
group by date(created_at), tipo
order by data desc;

-- ============ TEMPLATES PADRÃO ============
insert into notificacao_templates (tipo, dias_referencia, titulo, corpo, emoji) values
  -- Assinatura (contagem regressiva até a data de agendamento em `datas`)
  ('assinatura', 5, 'Faltam 5 dias!', 'Você já sabe que faltam só 5 dias para a gente se encontrar?', '📬'),
  ('assinatura', 4, 'Contagem regressiva: 4 dias!', 'Tá chegando a hora! Vem a gente resolver isso juntas?', '📬'),
  ('assinatura', 3, '3 dias! Tá chegando a hora!', 'Já tá tudo pronto, querida. Faltam só 3 dias!', '🎯'),
  ('assinatura', 2, 'Quase lá! 2 dias!', 'Amanhã cê se vê de novo! Ansiedade boa, né?', '✨'),
  ('assinatura', 1, 'AMANHÃ É O DIA!', 'Acordas comigo amanhã pra assinar os termos? Tá tudo pronto aqui!', '📬'),
  ('assinatura', 0, 'HOJE É O DIA! Vem!', 'Tá aqui! Tá com tudo pronto! Vem assinar com a gente?', '✨'),

  -- Parcela a vencer
  ('parcela_vencer', 1, 'Sua parcela vence amanhã!', 'Só mais um dia! Depois você fica tranquila de novo.', '💳'),

  -- Parcela atrasada (dias_referencia aqui = dias de atraso)
  ('parcela_atrasada', 1, 'Parcela vencida hoje!', 'Opa, passou! Mas sem problema, clica aqui pra resolver.', '📬'),
  ('parcela_atrasada', 2, 'Parcela já faz 2 dias...', 'A gente tá aqui pra ajudar! Teve algum problema?', '💬'),
  ('parcela_atrasada', 3, 'A gente acredita em você!', 'Já faz 3 dias. Tá tudo bem, mas vamos resolver? Clica aqui!', '💫'),
  ('parcela_atrasada', 4, 'Querida, tá na hora!', 'Já é o 4º dia. Precisa de ajuda? Fala com a gente!', '🕐'),
  ('parcela_atrasada', 5, 'Vamos conversar?', '5 dias já passaram. Tá com dificuldade? Podemos parcelar diferente.', '💭'),
  ('parcela_atrasada', 7, 'Uma semana já!', 'Amiga, tá ficando apertado. Clica pra conversar com a gente, sim?', '😢'),
  ('parcela_atrasada', 14, 'Duas semanas de atraso...', 'Precisamos de você! Vem conversar? Tem solução pra tudo.', '🤝')
on conflict do nothing;

-- ============ SUCESSO ============
select 'Tabelas de notificações criadas com sucesso!' as mensagem;
