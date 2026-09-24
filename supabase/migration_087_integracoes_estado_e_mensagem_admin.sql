-- 087 — Liga/desliga por integração e mensagem do dia escolhida pela equipe.
--
-- 1) integracoes_estado: uma linha por provedor (mesmos ids do catálogo de
--    credenciais). Sem linha = integração ativa (comportamento anterior).
--    Com ativo = false, o Worker não entrega nenhuma credencial do provedor
--    (nem a de variável de ambiente): a integração para de funcionar até ser
--    religada no painel (Admin/Dev Console → Integrações).
-- 2) mensagens_do_dia.origem passa a aceitar 'admin' (frase escrita pela
--    equipe no painel). A rotina diária continua igual e nunca sobrescreve
--    uma mensagem já pronta.
--
-- Não destrutiva. Rollback:
--   drop table public.integracoes_estado;
--   alter table public.mensagens_do_dia drop constraint mensagens_do_dia_origem_check;
--   alter table public.mensagens_do_dia add constraint mensagens_do_dia_origem_check
--     check (origem is null or origem in ('ia', 'catalogo', 'ultima_valida'));

create table if not exists public.integracoes_estado (
  provedor text primary key check (provedor ~ '^[a-z_]{2,40}$'),
  ativo boolean not null default true,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

-- Somente o backend (service role) lê e grava.
alter table public.integracoes_estado enable row level security;
revoke all on public.integracoes_estado from anon, authenticated;

alter table public.mensagens_do_dia drop constraint if exists mensagens_do_dia_origem_check;
alter table public.mensagens_do_dia add constraint mensagens_do_dia_origem_check
  check (origem is null or origem in ('ia', 'catalogo', 'ultima_valida', 'admin'));
