-- Funções de trigger/dispatch da migration 093 não devem ser executáveis
-- diretamente por anon/authenticated via PostgREST.
REVOKE ALL ON FUNCTION public.notificar_agendamento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notificar_liberacao_financeira() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notificar_revisao_financeira() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notificar_cliente(uuid,text,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;

-- O Worker chama notificar_cliente depois de autenticar/autorizá-la usando a
-- conexão de serviço. As funções de trigger continuam sendo disparadas pelos
-- próprios triggers, sem necessidade de grant público.
GRANT EXECUTE ON FUNCTION public.notificar_cliente(uuid,text,jsonb,uuid,text) TO service_role;
