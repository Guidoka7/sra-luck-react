-- 080 — Mensagem do dia única (substitui o cache por segmento da 079).
--
-- Fluxo: rotina diária (Vercel Cron → GET /api/cron/mensagem-do-dia) verifica
-- se já existe a mensagem da data; se não existir, chama o Gemini UMA vez e
-- grava aqui. O app só lê esta tabela: a mesma mensagem para todas as clientes.
--
-- Unicidade: a própria data é a chave primária (1 mensagem por data).
-- Concorrência: a rotina reserva a data com status 'gerando' antes de chamar o
-- Gemini; uma segunda execução simultânea encontra a reserva e não chama de novo.
-- Nenhum dado de cliente é gravado aqui.
--
-- public.frases_do_dia (079) deixa de ser usada pelo app; mantida por ser
-- migration não destrutiva. Rollback desta: drop table public.mensagens_do_dia;

create table if not exists public.mensagens_do_dia (
  data date primary key,
  status text not null default 'gerando' check (status in ('gerando', 'pronta')),
  texto text check (texto is null or char_length(texto) between 10 and 220),
  tema text check (tema is null or char_length(tema) between 2 and 60),
  origem text check (origem is null or origem in ('ia', 'catalogo', 'ultima_valida')),
  modelo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mensagens_do_dia_pronta_tem_texto check (status = 'gerando' or (texto is not null and tema is not null and origem is not null))
);

-- Somente o backend (service role) lê e grava.
alter table public.mensagens_do_dia enable row level security;
revoke all on public.mensagens_do_dia from anon, authenticated;
