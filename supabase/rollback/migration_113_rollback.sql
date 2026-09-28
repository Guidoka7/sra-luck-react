-- Rollback da migration_113: remove só o que ela criou. Vendas, execuções e itens ficam intactos.
-- ATENÇÃO: voltar junto o App que usa estas funções (senão a importação do RD falha ao registrar pendências).
drop view if exists public.vw_vendas_validas_bi;
drop function if exists public.rd_recalcular_pendencias_todas(text);
drop function if exists public.rd_recalcular_pendencias_venda(uuid, text, uuid, text);
drop function if exists public.rd_cpf_valido(text);
drop function if exists public.integracao_resolver_pendencias(text, text, text[], text, text);
drop function if exists public.integracao_registrar_pendencia(text, text, text, text, text, text[], text, uuid, uuid, jsonb, boolean);
drop table if exists public.colaborador_vinculos_externos;
drop table if exists public.integracao_pendencias;
