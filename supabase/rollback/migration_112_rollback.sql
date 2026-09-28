-- Rollback da migration_112: remove só a função. Nenhum dado é alterado.
-- ATENÇÃO: o App que chama agenda_registrar_levantamento precisa voltar junto
-- (deploy anterior), senão "Concluir levantamento" passa a responder erro.
drop function if exists public.agenda_registrar_levantamento(uuid, text, numeric, text[], numeric, text, text);
