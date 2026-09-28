-- A lista do funil agrega no Postgres e devolve uma página; contadores são exatos.
-- A mesma regra de status e composição financeira da leitura anterior é mantida.
CREATE OR REPLACE FUNCTION public.loadtest_finance_client_funnel(
  p_bucket text,p_busca text,p_ordenacao text,p_pagina integer,p_limite integer,p_hoje date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE resultado jsonb;
BEGIN
  IF p_pagina < 1 OR p_pagina > 100000 OR p_limite < 1 OR p_limite > 100
      OR p_bucket NOT IN ('todos','aguardando_conferencia','ativos','suspensos','negativados','cancelados')
      OR p_ordenacao NOT IN ('venc','saldo','az','za') THEN
    RAISE EXCEPTION 'Filtro financeiro invalido';
  END IF;

  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON (boleto_id) boleto_id,juros,multa,desconto
    FROM public.financeiro_recebimentos
    ORDER BY boleto_id,(status_validacao='validado') DESC,created_at DESC
  ), agregado AS MATERIALIZED (
    SELECT b.cliente_id,count(*)::integer AS total,
      count(*) FILTER (WHERE NOT b.suspensa AND b.status::text='pago')::integer AS pagas,
      coalesce(sum(round(coalesce(b.valor,0),2)+round(coalesce(r.juros,0),2)
        +round(coalesce(r.multa,0),2)-round(coalesce(r.desconto,0),2))
        FILTER (WHERE b.suspensa OR b.status::text<>'pago'),0) AS saldo,
      count(*) FILTER (WHERE NOT b.suspensa AND b.status::text='nao_pago' AND b.data_vencimento<p_hoje)::integer AS vencidas,
      count(*) FILTER (WHERE NOT b.suspensa AND b.status::text='pendente_confirmacao')::integer AS aguardando,
      min(b.data_vencimento) FILTER (WHERE b.suspensa OR b.status::text<>'pago') AS proximo_vencimento
    FROM public.boletos b LEFT JOIN latest r ON r.boleto_id=b.id
    GROUP BY b.cliente_id
  ), vendas AS MATERIALIZED (
    SELECT DISTINCT ON (cliente_id) cliente_id,origem_venda FROM public.novas_vendas
    WHERE cliente_id IS NOT NULL AND origem_venda IS NOT NULL
    ORDER BY cliente_id,created_at,id
  ), todos AS MATERIALIZED (
    SELECT c.id AS cliente_id,c.nome_completo AS nome,c.cpf,c.status_contrato::text AS status_contrato,
      c.consultora AS vendedora,v.origem_venda AS campanha,a.total,a.pagas,a.saldo,a.vencidas,a.aguardando,a.proximo_vencimento,
      CASE WHEN c.status_contrato::text='cancelado' THEN 'cancelados'
        WHEN c.status_contrato::text='negativado' THEN 'negativados'
        WHEN c.status_contrato::text='suspenso' THEN 'suspensos'
        WHEN a.aguardando>0 THEN 'aguardando_conferencia' ELSE 'ativos' END AS bucket
    FROM agregado a JOIN public.clientes c ON c.id=a.cliente_id
      LEFT JOIN vendas v ON v.cliente_id=c.id
  ), filtrados AS MATERIALIZED (
    SELECT * FROM todos WHERE (p_bucket='todos' OR bucket=p_bucket)
      AND (coalesce(p_busca,'')='' OR concat_ws(' ',nome,cpf,vendedora,campanha) ILIKE '%' || p_busca || '%')
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY
      CASE WHEN p_ordenacao='venc' THEN proximo_vencimento END ASC NULLS LAST,
      CASE WHEN p_ordenacao='saldo' THEN saldo END DESC NULLS LAST,
      CASE WHEN p_ordenacao='az' THEN nome END ASC NULLS LAST,
      CASE WHEN p_ordenacao='za' THEN nome END DESC NULLS LAST,
      cliente_id ASC
    LIMIT p_limite OFFSET (p_pagina-1)*p_limite
  )
  SELECT jsonb_build_object(
    'total',(SELECT count(*) FROM filtrados),
    'funis',jsonb_build_array(
      jsonb_build_object('bucket','aguardando_conferencia','total',(SELECT count(*) FROM todos WHERE bucket='aguardando_conferencia')),
      jsonb_build_object('bucket','ativos','total',(SELECT count(*) FROM todos WHERE bucket='ativos')),
      jsonb_build_object('bucket','todos','total',(SELECT count(*) FROM todos)),
      jsonb_build_object('bucket','suspensos','total',(SELECT count(*) FROM todos WHERE bucket='suspensos')),
      jsonb_build_object('bucket','negativados','total',(SELECT count(*) FROM todos WHERE bucket='negativados')),
      jsonb_build_object('bucket','cancelados','total',(SELECT count(*) FROM todos WHERE bucket='cancelados'))),
    'itens',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM pagina p)
  ) INTO resultado;
  RETURN resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.loadtest_finance_client_funnel(text,text,text,integer,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_finance_client_funnel(text,text,text,integer,integer,date) TO service_role;
