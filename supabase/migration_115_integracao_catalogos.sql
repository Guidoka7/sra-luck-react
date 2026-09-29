-- migration_115 — catálogo pré-calculado das integrações (RD Station: funis, etapas, campos e valores por funil).
--
-- Antes, abrir a configuração do RD no Dev Console lia todos os contatos e todas as negociações de
-- cada funil no RD para descobrir os campos (passava de 30 s). O Worker agora monta o catálogo com
-- poucas leituras (worker/crm-catalogo.ts) e o guarda aqui; a tela lê a linha guardada na hora.
-- O agendador (/api/cron/integracoes) renova quando passa de 6 h; o Dev pode pedir "Atualizar do RD".
--
-- Conteúdo: somente metadados do CRM (nomes de funis/etapas/campos, nomes de usuários, fontes,
-- campanhas e opções de campos) e contagens da amostra. Nenhum dado pessoal de cliente é guardado.
--
-- Não destrutiva. Sem esta migration o App continua funcionando: o catálogo fica só em memória.
-- Rollback: supabase/rollback/migration_115_rollback.sql.

create table if not exists public.integracao_catalogos (
  provedor text not null check (provedor ~ '^[a-z0-9_]{2,40}$'),
  chave text not null check (chave ~ '^[a-z0-9_]{2,60}$'),
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  duracao_ms integer,
  erro text,
  erro_em timestamptz,
  primary key (provedor, chave)
);

alter table public.integracao_catalogos enable row level security;
revoke all on table public.integracao_catalogos from anon, authenticated;
grant select, insert, update on table public.integracao_catalogos to service_role;
