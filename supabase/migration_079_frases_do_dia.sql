-- 079 — Frase do dia gerada por IA (agente de frases da Início da cliente).
--
-- Cache diário: uma frase por data (fuso de Brasília) e por segmento da jornada
-- (inicio | construindo | metade | quitado). O worker gera com o Gemini na
-- primeira abertura do dia e as demais clientes do mesmo segmento reaproveitam.
-- Nenhum dado pessoal é enviado ao provedor nem gravado aqui: o primeiro nome
-- é aplicado pelo worker na hora de responder ({nome} no texto).
--
-- Aditiva e não destrutiva. Rollback: drop table public.frases_do_dia;

create table if not exists public.frases_do_dia (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  segmento text not null check (segmento in ('inicio', 'construindo', 'metade', 'quitado')),
  tema text not null check (char_length(tema) between 2 and 60),
  texto text not null check (char_length(texto) between 10 and 220),
  origem text not null check (origem in ('ia', 'catalogo')),
  modelo text,
  created_at timestamptz not null default now(),
  unique (data, segmento)
);

create index if not exists frases_do_dia_created_at_idx on public.frases_do_dia (created_at desc);

-- Somente o backend (service role) lê e grava. Sem políticas = sem acesso via anon/authenticated.
alter table public.frases_do_dia enable row level security;
revoke all on public.frases_do_dia from anon, authenticated;
