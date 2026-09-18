-- migration_054_clientes_rascunho_sem_defaults_financeiros.sql
-- Garante que um cadastro administrativo vazio não herde silenciosamente
-- um plano financeiro legado (R$ 0 / 12 parcelas) por defaults do schema.
--
-- Os fluxos que realmente criam financeiro informam esses valores
-- explicitamente; o cadastro da cliente permanece sem plano até essa ação.

alter table public.clientes
  alter column valor_contrato drop default,
  alter column quantidade_parcelas drop default;

comment on column public.clientes.valor_contrato is
  'Valor da carta de crédito. Sem default: permanece nulo até ser informado.';
comment on column public.clientes.quantidade_parcelas is
  'Sem default: permanece nulo até o administrador criar/configurar o Financeiro.';
