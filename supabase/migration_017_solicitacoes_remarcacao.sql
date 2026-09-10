create table if not exists solicitacoes_remarcacao_agendamento (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  agendamento_id uuid not null references agendamentos(id) on delete cascade,
  tipo text not null check (tipo in ('termos','cirurgia')),
  data_id uuid references datas(id) on delete set null,
  data_solicitada date,
  horario_termos time,
  status text not null default 'pendente' check (status in ('pendente','aprovada','recusada')),
  observacao text,
  analisada_por uuid,
  analisada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agendamento_id, tipo)
);

create index if not exists idx_solicitacoes_remarcacao_cliente on solicitacoes_remarcacao_agendamento(cliente_id, status, created_at desc);
create index if not exists idx_solicitacoes_remarcacao_pendentes on solicitacoes_remarcacao_agendamento(status, created_at asc);
