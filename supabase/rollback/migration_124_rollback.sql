-- Rollback da migration_124. Não apaga parcelas nem recebimentos criados pela integração.
drop function if exists public.conta_azul_importar_financeiro(uuid, text, jsonb, text);
drop function if exists public.conta_azul_registrar_baixa(uuid, date, numeric, numeric, numeric, text, text, text, text, text);
drop index if exists public.conta_azul_vinculos_cliente_idx;
alter table public.conta_azul_vinculos drop column if exists confirmado_em;
alter table public.conta_azul_vinculos drop column if exists confirmado_por;
alter table public.conta_azul_vinculos drop column if exists divergencias_aceitas;
alter table public.conta_azul_vinculos drop column if exists origem_vinculo;
drop table if exists public.cliente_vinculos_externos;
