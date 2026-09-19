-- migration_053_clientes_rascunho_opcional.sql
-- Permite que o mesmo ClienteDetailDrawer seja usado para criar uma cliente
-- sem inventar nome, CPF, nascimento ou carta de crédito.
--
-- A cliente só conseguirá autenticar no app quando CPF + data de nascimento
-- reais forem preenchidos posteriormente. Nenhum financeiro é criado aqui.

alter table public.clientes
  alter column nome_completo drop not null,
  alter column cpf drop not null,
  alter column data_nascimento drop not null,
  alter column valor_contrato drop not null;

comment on column public.clientes.nome_completo is
  'Pode ser nulo enquanto o cadastro administrativo estiver em rascunho.';
comment on column public.clientes.cpf is
  'Pode ser nulo enquanto o cadastro administrativo estiver em rascunho; quando informado continua único.';
comment on column public.clientes.data_nascimento is
  'Pode ser nulo enquanto o cadastro administrativo estiver em rascunho; necessário junto com CPF para login da cliente.';
comment on column public.clientes.valor_contrato is
  'Valor da carta de crédito. Pode ser nulo até ser informado pelo administrativo.';
