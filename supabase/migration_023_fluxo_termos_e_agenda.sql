-- ============================================================================
-- migration_023_fluxo_termos_e_agenda.sql
-- Regras operacionais do processo cirúrgico após o percentual mínimo.
-- ============================================================================

alter table contratos_credito add column if not exists levantamento_iniciado_em timestamptz;
alter table contratos_credito add column if not exists levantamento_prazo_ate date;
alter table contratos_credito add column if not exists levantamento_aprovado_em timestamptz;
alter table contratos_credito add column if not exists formas_quitacao_disponiveis text[] not null default '{}'::text[];
alter table contratos_credito add column if not exists escolha_forma_em timestamptz;
alter table contratos_credito add column if not exists quitado_em timestamptz;
alter table contratos_credito add column if not exists observacao_levantamento text;

create or replace function public.adicionar_dias_uteis(p_data date, p_dias integer)
returns date
language plpgsql
immutable
as $$
declare
  resultado date := p_data;
  adicionados integer := 0;
begin
  if p_dias <= 0 then return resultado; end if;
  while adicionados < p_dias loop
    resultado := resultado + 1;
    if extract(isodow from resultado) between 1 and 5 then
      adicionados := adicionados + 1;
    end if;
  end loop;
  return resultado;
end;
$$;

create or replace function public.reservar_janela_credito(
  p_contrato_id uuid,
  p_janela_id uuid,
  p_tipo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  janela agenda_janelas%rowtype;
  ocupadas integer;
  reserva_id uuid;
  contrato contratos_credito%rowtype;
begin
  if p_tipo not in ('termos','cirurgia') then
    raise exception 'TIPO_INVALIDO';
  end if;

  select * into contrato from contratos_credito where id = p_contrato_id for update;
  if not found then raise exception 'CONTRATO_NAO_ENCONTRADO'; end if;

  if p_tipo = 'termos' and contrato.etapa not in ('forma_pagamento_liberada','termos_agendados') then
    raise exception 'TERMOS_NAO_LIBERADOS';
  end if;

  if p_tipo = 'cirurgia' then
    if contrato.etapa not in ('agenda_cirurgica_liberada','cirurgia_agendada') then
      raise exception 'AGENDA_CIRURGICA_NAO_LIBERADA';
    end if;
    if contrato.agenda_cirurgica_liberar_em is null or contrato.agenda_cirurgica_liberar_em > current_date then
      raise exception 'PRAZO_CIRURGICO_NAO_CONCLUIDO';
    end if;
  end if;

  select * into janela from agenda_janelas where id = p_janela_id and tipo = p_tipo for update;
  if not found or janela.status <> 'disponivel' or janela.data < current_date then
    raise exception 'JANELA_INDISPONIVEL';
  end if;

  select count(*) into ocupadas
  from agenda_reservas_credito
  where janela_id = p_janela_id and status in ('agendado','confirmado');

  if ocupadas >= janela.vagas then raise exception 'VAGAS_ESGOTADAS'; end if;

  update agenda_reservas_credito
  set status = 'reagendado', updated_at = now()
  where contrato_credito_id = p_contrato_id
    and tipo = p_tipo
    and status in ('agendado','confirmado');

  insert into agenda_reservas_credito (contrato_credito_id, janela_id, tipo, status)
  values (p_contrato_id, p_janela_id, p_tipo, 'agendado')
  returning id into reserva_id;

  if p_tipo = 'termos' then
    update contratos_credito set etapa = 'termos_agendados', updated_at = now() where id = p_contrato_id;
  else
    update contratos_credito set etapa = 'cirurgia_agendada', cirurgia_em = janela.data, updated_at = now() where id = p_contrato_id;
  end if;

  return reserva_id;
end;
$$;

create or replace function public.atualizar_liberacao_cirurgica()
returns trigger
language plpgsql
as $$
begin
  if new.termos_assinados_em is not null and new.quitado_em is not null then
    new.agenda_cirurgica_liberar_em := public.adicionar_dias_uteis(new.termos_assinados_em::date, 5);
    if new.agenda_cirurgica_liberar_em <= current_date then
      new.etapa := 'agenda_cirurgica_liberada';
    elsif new.etapa not in ('cirurgia_agendada','concluido') then
      new.etapa := 'quitado';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_liberacao_cirurgica on contratos_credito;
create trigger trg_contrato_liberacao_cirurgica
before insert or update of termos_assinados_em, quitado_em on contratos_credito
for each row execute function public.atualizar_liberacao_cirurgica();

-- Previsão baseada no valor contratual das parcelas vinculadas, não em simples contagem.
create or replace view public.vw_previsao_elegibilidade as
with parcelas as (
  select
    c.id as contrato_id,
    c.cliente_id,
    c.valor_contrato,
    c.percentual_minimo,
    b.id as boleto_id,
    b.data_vencimento,
    b.valor,
    sum(b.valor) over (partition by c.id order by b.data_vencimento, b.numero_parcela rows unbounded preceding) as acumulado_previsto
  from contratos_credito c
  join boletos b on b.contrato_credito_id = c.id
  where c.etapa not in ('cancelado','concluido')
), alvo as (
  select *, (valor_contrato * percentual_minimo / 100.0) as valor_meta
  from parcelas
)
select distinct on (contrato_id)
  contrato_id,
  cliente_id,
  valor_contrato,
  percentual_minimo,
  valor_meta,
  data_vencimento as previsao_atingir_percentual,
  acumulado_previsto
from alvo
where acumulado_previsto >= valor_meta
order by contrato_id, data_vencimento, boleto_id;
