-- ============================================================================
-- MIGRATION 009: Revisão financeira manual + previsão de liberação financeira
-- Execute no SQL Editor do Supabase após testar em dev
--
-- Contexto:
-- 1) Antes, assim que a cliente atingia o % de pagamento necessário, a
--    agenda era liberada automaticamente. Agora isso vira uma ETAPA DE
--    REVISÃO: ao atingir o percentual, a cliente aparece pro admin como
--    "pendente" num card de confirmação. Só depois que o admin CONFIRMA
--    (levantamento financeiro OK) a agenda é realmente liberada. Se o
--    admin RECUSAR, foi porque o levantamento encontrou divergência.
-- 2) Quando a cliente vem assinar os termos cirúrgicos (agendamento
--    confirmado), o admin informa, no ato da assinatura, uma PREVISÃO DE
--    LIBERAÇÃO FINANCEIRA — a data em que a empresa fará o pagamento da
--    cirurgia dela. Essa data fica registrada no agendamento e aparece
--    pra cliente no app como atualização pós-termos.
-- ============================================================================

-- 1. Status da revisão financeira manual da cliente
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_revisao_financeira') then
    create type status_revisao_financeira as enum ('pendente', 'aprovada', 'recusada');
  end if;
end $$;

alter table clientes add column if not exists status_revisao_financeira status_revisao_financeira;
alter table clientes add column if not exists data_atingiu_percentual timestamptz;
alter table clientes add column if not exists observacao_revisao_financeira text;

-- 2. Previsão de liberação financeira, definida por agendamento (assinatura
--    dos termos). Fica no agendamento, não na cliente, pra ficar amarrada
--    ao encontro em que foi informada.
alter table agendamentos add column if not exists previsao_liberacao_financeira date;

create index if not exists idx_agendamentos_previsao_liberacao
  on agendamentos(previsao_liberacao_financeira);

-- ============================================================================
-- FUNÇÃO: agenda_liberada — gate REAL de acesso ao calendário de termos.
-- Diferente de pode_agendar() (que só olha o % pago), essa função também
-- exige aprovação manual do admin após o levantamento financeiro.
-- ============================================================================
create or replace function agenda_liberada(p_cliente_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select status_revisao_financeira = 'aprovada' from clientes where id = p_cliente_id),
    false
  );
$$;

-- ============================================================================
-- FUNÇÃO/TRIGGER: sincroniza status_revisao_financeira sempre que os
-- boletos de uma cliente mudam de status. Só marca "pendente" na primeira
-- vez que o % necessário é atingido (não sobrescreve uma decisão manual
-- já tomada). Se a cliente cai abaixo do % de novo (ex.: pagamento
-- rejeitado após confirmado por engano), o status volta pro início.
-- ============================================================================
create or replace function sincronizar_revisao_financeira()
returns trigger
language plpgsql
as $$
declare
  v_cliente_id uuid;
  v_pode boolean;
  v_status status_revisao_financeira;
begin
  v_cliente_id := coalesce(new.cliente_id, old.cliente_id);
  v_pode := pode_agendar(v_cliente_id);

  select status_revisao_financeira into v_status from clientes where id = v_cliente_id;

  if v_pode and v_status is null then
    update clientes
    set status_revisao_financeira = 'pendente', data_atingiu_percentual = now()
    where id = v_cliente_id;
  elsif not v_pode and v_status is not null then
    update clientes
    set status_revisao_financeira = null, data_atingiu_percentual = null, observacao_revisao_financeira = null
    where id = v_cliente_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sincronizar_revisao_financeira on boletos;
create trigger trg_sincronizar_revisao_financeira
after insert or update or delete on boletos
for each row execute function sincronizar_revisao_financeira();
