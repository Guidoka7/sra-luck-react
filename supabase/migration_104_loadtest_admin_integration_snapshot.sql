-- Snapshot de leitura do painel de integrações. Nenhum provedor é chamado.
-- As credenciais cifradas continuam em consulta separada, por requisição.
CREATE OR REPLACE FUNCTION public.loadtest_admin_integration_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE conta_azul_total bigint;
BEGIN
  IF to_regclass('public.conta_azul_operacoes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.conta_azul_operacoes' INTO conta_azul_total;
  END IF;

  RETURN jsonb_build_object(
    'estados', (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
      FROM (SELECT provedor,ativo,atualizado_por,atualizado_em FROM public.integracoes_estado) e),
    'disponibilidade', jsonb_build_object(
      'push', to_regclass('public.web_push_subscriptions') IS NOT NULL,
      'eventos', to_regclass('public.integracao_eventos') IS NOT NULL,
      'pagamentos', to_regclass('public.pagamentos_externos') IS NOT NULL,
      'contaAzul', to_regclass('public.conta_azul_operacoes') IS NOT NULL,
      'crm', to_regclass('public.crm_vendas_entrada') IS NOT NULL,
      'vendas', to_regclass('public.novas_vendas') IS NOT NULL,
      'frases', to_regclass('public.mensagens_do_dia') IS NOT NULL
    ),
    'contagens', jsonb_build_object(
      'push', (SELECT count(*) FROM public.web_push_subscriptions),
      'pagamentos', (SELECT count(*) FROM public.pagamentos_externos),
      'contaAzul', conta_azul_total,
      'vendas', (SELECT count(*) FROM public.novas_vendas),
      'frasesIa', (SELECT count(*) FROM public.mensagens_do_dia WHERE origem='ia')
    ),
    'rd', jsonb_build_object(
      'ultimaSincronizacao', (SELECT created_at FROM public.integracao_eventos
        WHERE provedor='rd_station' AND event_type='sync_manual'
        ORDER BY created_at DESC LIMIT 1),
      'erros', (SELECT count(*) FROM public.integracao_eventos
        WHERE provedor='rd_station' AND status='erro'),
      'ultimoWebhook', (SELECT created_at FROM public.crm_vendas_entrada
        WHERE provedor='rd_station' ORDER BY created_at DESC LIMIT 1)
    ),
    'verificacoes', public.loadtest_admin_integration_checks()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_integration_snapshot()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_integration_snapshot()
  TO service_role;
