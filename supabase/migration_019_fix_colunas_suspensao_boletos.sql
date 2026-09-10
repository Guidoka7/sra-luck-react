-- MIGRATION 019: Corrige schema ausente usado pela gestão de parcelas.
-- Pode ser executada com segurança mesmo que a migration 017 já tenha sido aplicada.

alter table boletos add column if not exists suspensa boolean not null default false;
alter table boletos add column if not exists suspensa_em timestamptz;
alter table boletos add column if not exists suspensa_por text;

create index if not exists idx_boletos_suspensa
  on boletos(cliente_id, suspensa)
  where suspensa = true;

-- Garante que os registros existentes tenham um total coerente.
update boletos b
set total_parcelas = c.quantidade_parcelas
from clientes c
where c.id = b.cliente_id
  and c.quantidade_parcelas between 1 and 240
  and (b.total_parcelas is null or b.total_parcelas = 10000);
