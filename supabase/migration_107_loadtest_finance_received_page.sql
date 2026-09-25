-- Dia operacional em Sao Paulo; vencidos independem do seletor de dia.
-- Uma página de registros substitui o download de todos os carnês e recebimentos.
CREATE OR REPLACE FUNCTION public.loadtest_finance_received_page(
  p_tipo text,p_data date,p_busca text,p_pagina integer,p_limite integer,p_hoje date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE resultado jsonb;
BEGIN
  IF p_tipo NOT IN ('recebidos','vencidos') OR p_pagina<1 OR p_pagina>100000
    OR p_limite<1 OR p_limite>100 THEN RAISE EXCEPTION 'Filtro financeiro invalido'; END IF;

  WITH candidatos AS MATERIALIZED (
    SELECT r.boleto_id,r.id AS recebimento_id,r.validado_em AS confirmado_em
    FROM public.financeiro_recebimentos r
    WHERE p_tipo='recebidos' AND r.status_validacao='validado'
      AND r.validado_em >= (p_data::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND r.validado_em < ((p_data+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    UNION ALL
    SELECT b.id,NULL::uuid,NULL::timestamptz FROM public.boletos b
    WHERE p_tipo='vencidos' AND b.status::text='nao_pago' AND NOT b.suspensa AND b.data_vencimento<p_hoje
  ), filtrados AS MATERIALIZED (
    SELECT b.id,b.cliente_id,b.numero_parcela,b.total_parcelas,b.valor,b.data_vencimento,
      b.status,b.comprovante_url,b.data_pagamento,b.observacoes,b.created_at,b.updated_at,b.suspensa,
      c.nome_completo,c.cpf,atual.id AS ultimo_recebimento_id,
      atual.status_validacao,atual.juros,atual.multa,atual.desconto,atual.valor_recebido,
      atual.forma_pagamento,atual.origem_boleto,atual.origem,atual.instituicao_financeira,
      atual.instituicao_conta,atual.data_pagamento AS recebimento_data,
      atual.comprovante_url AS recebimento_comprovante,atual.external_payment_id,
      atual.external_reference,atual.observacao,can.recebimento_id,can.confirmado_em
    FROM candidatos can JOIN public.boletos b ON b.id=can.boleto_id
      JOIN public.clientes c ON c.id=b.cliente_id
      LEFT JOIN LATERAL (
        SELECT id,status_validacao,juros,multa,desconto,valor_recebido,forma_pagamento,
          origem_boleto,origem,instituicao_financeira,instituicao_conta,data_pagamento,
          comprovante_url,external_payment_id,external_reference,observacao
        FROM public.financeiro_recebimentos r WHERE r.boleto_id=b.id
        ORDER BY (r.status_validacao='validado') DESC,r.created_at DESC LIMIT 1
      ) atual ON true
    WHERE coalesce(p_busca,'')='' OR concat_ws(' ',c.nome_completo,c.cpf,
      b.numero_parcela::text||'/'||b.total_parcelas::text,
      coalesce(atual.origem_boleto,atual.origem,'interno'),atual.forma_pagamento) ILIKE '%' || p_busca || '%'
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY
      CASE WHEN p_tipo='recebidos' THEN confirmado_em END DESC NULLS LAST,
      CASE WHEN p_tipo='vencidos' THEN data_vencimento END ASC NULLS LAST,id ASC
    LIMIT p_limite OFFSET (p_pagina-1)*p_limite
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtrados),
    'itens',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM pagina p)) INTO resultado;
  RETURN resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.loadtest_finance_received_page(text,date,text,integer,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_finance_received_page(text,date,text,integer,integer,date) TO service_role;
