-- migration_055_clientes_percentual_minimo_agendar.sql
-- Compatibilidade do novo drawer com ambientes onde a migration histórica 010
-- não foi aplicada. Mantém rascunhos sem financeiro com valor nulo.

alter table public.clientes
  add column if not exists percentual_minimo_agendar numeric(5,2);

update public.clientes
set percentual_minimo_agendar = case
  when quantidade_parcelas in (12, 18, 24) then 60
  when quantidade_parcelas = 36 then 70
  when quantidade_parcelas is not null then 80
  else null
end
where percentual_minimo_agendar is null
  and quantidade_parcelas is not null;

comment on column public.clientes.percentual_minimo_agendar is
  'Percentual de parcelas pagas necessário para elegibilidade. Pode ser nulo enquanto não houver plano financeiro.';
