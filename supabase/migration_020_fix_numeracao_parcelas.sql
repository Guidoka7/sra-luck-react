-- MIGRATION 020: remove a blindagem 9001/10000 incorreta e saneia a numeracao.
-- O trigger da migration 018 convertia 9001 para numero negativo, mas
-- chk_numero_parcela exige numero > 0. Isso causava o erro -9010.

-- 1) Desliga definitivamente o trigger que inventava numeros temporarios.
drop trigger if exists trg_proteger_numeracao_temporaria_boletos on boletos;
drop function if exists proteger_numeracao_temporaria_boletos();

-- 2) Remove temporariamente as restricoes que impedem o saneamento em lote.
alter table boletos drop constraint if exists chk_numero_parcela;
drop index if exists uniq_boleto_por_parcela;

-- 3) Reconstroi a numeracao de cada cliente em 1..N.
-- Preserva a ordem numerica existente; em caso de empate, usa created_at/id.
-- Se houver dados corrompidos 9001/10000, eles entram na mesma sequencia normal.
with ranked as (
  select
    id,
    row_number() over (
      partition by cliente_id
      order by numero_parcela asc, created_at asc, id asc
    )::integer as novo_numero,
    count(*) over (partition by cliente_id)::integer as novo_total
  from boletos
), atualizacao as (
  select id, novo_numero, novo_total
  from ranked
  where novo_total between 1 and 240
)
update boletos b
set
  numero_parcela = a.novo_numero,
  total_parcelas = a.novo_total
from atualizacao a
where b.id = a.id;

-- Se alguma cliente tiver mais de 240 registros, interrompe antes de
-- reinstalar a constraint, evitando mascarar dados que precisam de revisão.
do $$
begin
  if exists (
    select 1
    from boletos
    group by cliente_id
    having count(*) > 240
  ) then
    raise exception 'Existem clientes com mais de 240 boletos; revise esses registros antes de concluir a migration 020.';
  end if;
end $$;

-- 4) Reinstala as regras definitivas.
alter table boletos
  add constraint chk_numero_parcela
  check (numero_parcela > 0 and numero_parcela <= total_parcelas);

create unique index uniq_boleto_por_parcela
  on boletos(cliente_id, numero_parcela);

-- 5) Garante que o cadastro da cliente reflita o numero real de parcelas.
update clientes c
set quantidade_parcelas = x.total
from (
  select cliente_id, count(*)::integer as total
  from boletos
  group by cliente_id
) x
where c.id = x.cliente_id
  and x.total between 1 and 240;
