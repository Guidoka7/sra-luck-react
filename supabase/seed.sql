-- SRA. LUCK — SEED IDEMPOTENTE
-- Não cria usuário Auth nem senha de teste. Administradores devem ser criados pelo
-- fluxo seguro do Supabase Auth e vinculados no painel administrativo.

begin;

insert into public.clube_recompensas(titulo, descricao, categoria, pontos, estoque, ativo)
select seed.titulo, seed.descricao, seed.categoria, seed.pontos, seed.estoque, true
from (values
  ('Kit Giovanna Baby','Kit presente com itens selecionados para autocuidado.','Autocuidado',600,20),
  ('Massagem relaxante','Sessão de massagem em parceiro credenciado.','Bem-estar',900,20),
  ('Nécessaire premium','Nécessaire Sra. Luck em edição especial.','Mimo',450,50),
  ('Vale-spa','Crédito para experiência de spa em parceiro selecionado.','Experiência',1200,10),
  ('Kit autocuidado','Seleção de cuidados pessoais e aromaterapia.','Autocuidado',750,30),
  ('Voucher de beleza','Voucher para serviço de beleza em estabelecimento parceiro.','Experiência',1000,15)
) as seed(titulo, descricao, categoria, pontos, estoque)
where not exists (
  select 1 from public.clube_recompensas existing where lower(existing.titulo) = lower(seed.titulo)
);

insert into public.comissao_regras(perfil, nome, tipo, valor, meta_base, configuracao, ativo)
select seed.perfil, seed.nome, seed.tipo, seed.valor, seed.meta_base, '{}'::jsonb, true
from (values
  ('vendedora','Primeira parcela paga','valor_fixo',100.00::numeric,null::numeric),
  ('sdr','Comparecimento em agendamento','valor_fixo',10.00::numeric,null::numeric),
  ('financeiro','Recuperação de carteira em atraso','percentual',1.69::numeric,90000.00::numeric)
) as seed(perfil, nome, tipo, valor, meta_base)
where not exists (
  select 1 from public.comissao_regras existing
  where existing.perfil = seed.perfil and lower(existing.nome) = lower(seed.nome) and existing.ativo = true
);

commit;
