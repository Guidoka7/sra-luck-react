-- Feedback da jornada da cliente
create table if not exists public.feedback_jornada (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  enviado_google boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feedback_jornada_cliente on public.feedback_jornada(cliente_id);
create index if not exists idx_feedback_jornada_created_at on public.feedback_jornada(created_at desc);

alter table public.feedback_jornada enable row level security;

-- A API usa a service role depois de validar a sessão da cliente.
