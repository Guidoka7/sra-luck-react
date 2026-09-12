-- ============================================================================
-- migration_035_credenciais_integracoes.sql
-- Permite configurar credenciais de integrações (Mercado Pago, Conta Azul,
-- RD Station, bancos, Web Push) pelo próprio painel admin, sem editar código
-- ou variáveis de ambiente do Worker.
--
-- O valor é armazenado cifrado (AES-GCM, chave derivada de
-- CLIENTE_SESSION_SECRET) e nunca é devolvido em texto puro por nenhuma rota
-- de leitura — apenas uma máscara (últimos 4 caracteres) é exposta ao painel.
--
-- Esta migration NÃO é aplicada automaticamente em produção. Aplicar apenas
-- mediante autorização explícita.
-- ============================================================================

create table if not exists integracoes_credenciais (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  chave text not null,
  valor_cifrado text not null,
  valor_iv text not null,
  valor_mascarado text not null,
  ativo boolean not null default true,
  atualizado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (provedor, chave)
);

create index if not exists integracoes_credenciais_provedor_idx on integracoes_credenciais(provedor);

alter table integracoes_credenciais enable row level security;

create policy "admin_full_access_integracoes_credenciais" on integracoes_credenciais
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
