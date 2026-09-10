-- MIGRATION 018: blindagem definitiva contra o bug 9001/10000
-- Compatível inclusive com versões antigas do Route Handler que ainda usam
-- 9001/10000 como número temporário.

create or replace function proteger_numeracao_temporaria_boletos()
returns trigger
language plpgsql
as $$
declare
  v_total integer;
  v_temp integer;
begin
  if new.numero_parcela >= 9001 or new.total_parcelas = 10000 then
    select count(*) into v_total from boletos where cliente_id = new.cliente_id;
    v_total := greatest(v_total, 1);

    -- O código antigo usa 9001/10000 somente como faixa temporária para
    -- escapar da UNIQUE(cliente_id, numero_parcela). Convertemos isso para
    -- uma faixa negativa segura; o próprio código antigo depois grava a
    -- numeração definitiva.
    v_temp := -abs(coalesce(new.numero_parcela, 1));
    if v_temp = 0 then v_temp := -1; end if;

    new.numero_parcela := v_temp;
    new.total_parcelas := least(greatest(v_total, 1), 240);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_numeracao_temporaria_boletos on boletos;
create trigger trg_proteger_numeracao_temporaria_boletos
before insert or update of numero_parcela, total_parcelas on boletos
for each row
execute function proteger_numeracao_temporaria_boletos();
