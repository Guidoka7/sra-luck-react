-- Exclusivo da branch de ensaio. Retorna a verificação mais recente por
-- provedor sem emitir uma consulta REST sequencial para cada integração.
CREATE OR REPLACE FUNCTION public.loadtest_admin_integration_checks()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(provedor, jsonb_build_object(
    'created_at', created_at, 'detalhes', detalhes
  )), '{}'::jsonb)
  FROM (
    SELECT DISTINCT ON (detalhes->>'provedor')
      detalhes->>'provedor' AS provedor, created_at, detalhes
    FROM public.logs_alteracoes
    WHERE acao = 'testou_conexao_integracao'
      AND detalhes->>'provedor' = ANY (ARRAY[
        'web_push','mercado_pago','conta_azul','rd_station','gemini',
        'brb','bb','santander','sicredi','efi'
      ])
    ORDER BY detalhes->>'provedor', created_at DESC
  ) AS recentes;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_integration_checks()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_integration_checks()
  TO service_role;
