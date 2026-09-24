-- Campanhas/missões configuráveis do Clube de Vantagens.
-- As campanhas alteram conteúdo/visibilidade. Pontuação automática continua centralizada em clube_config.

create table if not exists public.clube_campanhas (
  id uuid primary key default gen_random_uuid(),
  chave text unique,
  tipo text not null check (tipo in ('primeira_parcela','parcela_em_dia','indicacao','resgate','informativa')),
  titulo text not null check (length(btrim(titulo)) between 2 and 120),
  descricao text,
  recompensa_texto text,
  ativo boolean not null default true,
  ordem integer not null default 0,
  excluido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clube_campanhas enable row level security;
revoke all on table public.clube_campanhas from public, anon, authenticated;
grant select, insert, update, delete on table public.clube_campanhas to service_role;

create index if not exists idx_clube_campanhas_catalogo
  on public.clube_campanhas(ativo, ordem, created_at)
  where excluido_em is null;

insert into public.clube_campanhas (chave,tipo,titulo,descricao,ativo,ordem)
values
  ('primeira_parcela','primeira_parcela','Pague a 1ª parcela','Ao confirmar o seu primeiro pagamento, você ganha pontos e libera o voucher de consulta com o Doutor.',true,10),
  ('parcela_em_dia','parcela_em_dia','Pague em dia','Toda parcela paga até o vencimento vale pontos. Quanto mais em dia, mais perto do seu prêmio.',true,20),
  ('indicacao','indicacao','Indique uma amiga','Você ganha quando a amiga indicada fechar contrato e pagar a 1ª parcela.',true,30),
  ('resgate','resgate','Resgate um benefício','Use os pontos acumulados para escolher um benefício disponível no catálogo.',true,40)
on conflict (chave) do nothing;
