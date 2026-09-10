-- MIGRATION 021: remove o trigger legado 9001/10000 e saneia parcelas corrompidas.
--
-- A migration 018 criou um trigger que transformava 9001 em numero negativo.
-- Como boletos possui chk_numero_parcela > 0, isso gerava o erro -9010.
-- A migration 020 remove esse trigger, mas pode ter sido abortada quando
-- encontrou clientes com milhares de registros contaminados. Esta migration
-- e idempotente e corrige esse estado sem apagar dados silenciosamente:
-- registros invalidos sao arquivados antes da remocao.

-- 1) Remove definitivamente a blindagem antiga.
drop trigger if exists trg_proteger_numeracao_temporaria_boletos on boletos;
drop function if exists proteger_numeracao_temporaria_boletos();

-- 2) Guarda uma copia dos registros claramente corrompidos antes de remove-los.
-- Um boleto legitimo nunca pode ter numero >= 9001 nem total = 10000 porque
-- a regra de negocio do sistema e de no maximo 240 parcelas.
create table if not exists boletos_corrompidos_9001_backup as
select b.*, now() as arquivado_em, 'bug_9001_10000'::text as motivo
from boletos b
where false;

insert into boletos_corrompidos_9001_backup
select b.*, now(), 'bug_9001_10000'
from boletos b
where (b.numero_parcela >= 9001 or b.total_parcelas = 10000)
  and not exists (
    select 1
    from boletos_corrompidos_9001_backup x
    where x.id = b.id
  );

-- 3) Remove os registros contaminados do carnê ativo.
delete from boletos
where numero_parcela >= 9001
   or total_parcelas = 10000;

-- 4) Recria a numeração de cada cliente sem usar 9001/10000.
-- O constraint e o indice unique ficam temporariamente fora para permitir
-- a troca segura da numeração dentro da mesma transação.
alter table boletos drop constraint if exists chk_numero_parcela;
drop index if exists uniq_boleto_por_parcela;

with ranked as (
  select
    id,
    row_number() over (
      partition by cliente_id
      order by numero_parcela asc, created_at asc, id asc
    )::integer as novo_numero,
    count(*) over (partition by cliente_id)::integer as novo_total
  from boletos
)
update boletos b
set
  numero_parcela = -r.novo_numero,
  total_parcelas = r.novo_total
from ranked r
where b.id = r.id;

with ranked as (
  select
    id,
    row_number() over (
      partition by cliente_id
      order by numero_parcela desc, created_at asc, id asc
    )::integer as novo_numero,
    count(*) over (partition by cliente_id)::integer as novo_total
  from boletos
)
update boletos b
set
  numero_parcela = r.novo_numero,
  total_parcelas = r.novo_total
from ranked r
where b.id = r.id;

-- 5) Nenhum contrato pode ultrapassar 240 parcelas.
do $$
begin
  if exists (
    select 1
    from boletos
    group by cliente_id
    having count(*) > 240
  ) then
    raise exception 'Ainda existem clientes com mais de 240 parcelas apos a limpeza. Revise os dados antes de continuar.';
  end if;
end $$;

alter table boletos
  add constraint chk_numero_parcela
  check (numero_parcela > 0 and numero_parcela <= total_parcelas);

create unique index uniq_boleto_por_parcela
  on boletos(cliente_id, numero_parcela);

-- 6) Sincroniza o total salvo na cliente com o total real do carnê.
update clientes c
set quantidade_parcelas = x.total
from (
  select cliente_id, count(*)::integer as total
  from boletos
  group by cliente_id
) x
where c.id = x.cliente_id
  and x.total between 1 and 240;

-- Clientes sem parcelas ativas ficam sem quantidade definida.
update clientes c
set quantidade_parcelas = null
where not exists (select 1 from boletos b where b.cliente_id = c.id);
