-- Exclusivo do ensaio isolado. A regra de previsão permanece em
-- worker/eligibility-forecast.ts; o banco só reúne 50 clientes e suas parcelas.
CREATE OR REPLACE FUNCTION public.loadtest_admin_forecast_page(
  p_limite integer DEFAULT 50,
  p_antes_criado timestamptz DEFAULT NULL,
  p_antes_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH pagina AS MATERIALIZED (
    SELECT id,nome_completo,cpf,quantidade_parcelas,consultora,
      data_atingiu_percentual,valor_contrato,ativo,created_at
    FROM public.clientes
    WHERE p_antes_criado IS NULL OR (created_at,id)<(p_antes_criado,p_antes_id)
    ORDER BY created_at DESC,id DESC
    LIMIT greatest(1,least(coalesce(p_limite,50),50))
  ), itens AS (
    SELECT p.created_at,p.id,jsonb_build_object(
      'cliente',to_jsonb(p),
      'parcelas',coalesce(b.parcelas,'[]'::jsonb),
      'contrato',NULL::jsonb,
      'crm',to_jsonb(cr)
    ) AS dados FROM pagina p
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.numero_parcela,b.data_vencimento NULLS LAST) AS parcelas
      FROM (SELECT numero_parcela,total_parcelas,status,data_vencimento,
        data_pagamento,suspensa,created_at
        FROM public.boletos WHERE cliente_id=p.id) b
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT cliente_cpf,campanha,origem,vendedor,status,created_at
      FROM public.crm_vendas_entrada
      WHERE regexp_replace(coalesce(cliente_cpf,''),'[^0-9]','','g')
        = regexp_replace(coalesce(p.cpf,''),'[^0-9]','','g')
      ORDER BY created_at DESC LIMIT 1
    ) cr ON true
  ), cursor_final AS (
    SELECT jsonb_build_object('criado',created_at,'id',id) AS valor
    FROM pagina ORDER BY created_at ASC,id ASC LIMIT 1
  )
  SELECT jsonb_build_object(
    'itens',(SELECT coalesce(jsonb_agg(dados ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM itens),
    'total',(SELECT count(*) FROM public.clientes),
    'cursor',(SELECT valor FROM cursor_final)
  );
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_forecast_page(integer,timestamptz,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_forecast_page(integer,timestamptz,uuid)
  TO service_role;
