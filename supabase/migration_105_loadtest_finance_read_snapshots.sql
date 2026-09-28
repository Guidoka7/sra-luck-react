-- Leituras financeiras por domínio. Somente o Worker com papel de serviço chama
-- estas funções depois de autenticar o Admin; nenhuma escrita é feita aqui.
CREATE OR REPLACE FUNCTION public.loadtest_finance_summary(p_inicio date, p_fim date, p_hoje date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH ids AS MATERIALIZED (
  SELECT id FROM public.boletos WHERE data_vencimento BETWEEN p_inicio AND p_fim
  UNION
  SELECT id FROM public.boletos WHERE data_vencimento BETWEEN p_hoje AND p_hoje + 90
  UNION
  SELECT id FROM public.boletos WHERE data_pagamento BETWEEN p_inicio AND p_fim
  UNION
  SELECT boleto_id FROM public.financeiro_recebimentos
    WHERE status_validacao = 'validado' AND data_pagamento BETWEEN p_inicio AND p_fim
), latest AS MATERIALIZED (
  SELECT DISTINCT ON (boleto_id) boleto_id,status_validacao,data_pagamento,valor_recebido
  FROM public.financeiro_recebimentos
  ORDER BY boleto_id,(status_validacao = 'validado') DESC,created_at DESC
), base AS MATERIALIZED (
  SELECT b.data_vencimento AS vencimento,b.status::text AS status,b.suspensa,
    coalesce(b.valor,0)::numeric AS previsto,
    CASE WHEN r.status_validacao = 'validado' THEN r.data_pagamento ELSE b.data_pagamento END AS data_recebida,
    CASE WHEN r.status_validacao = 'validado' THEN coalesce(r.valor_recebido,0)
         WHEN b.status::text = 'pago' THEN coalesce(b.valor,0) ELSE 0 END::numeric AS realizado,
    CASE WHEN coalesce(c.custo_total,0) > 0
      THEN (coalesce(greatest(0,coalesce(c.custo_total,0)-coalesce(c.valor_contrato,0)),0)
         + CASE WHEN coalesce(c.custo_total,0)-coalesce(c.valor_contrato,0) <= 0
             THEN coalesce(c.valor_contrato,0)*coalesce(c.taxa_administrativa_percentual,0)/100
             ELSE 0 END) / c.custo_total
      ELSE 0 END::numeric AS fracao_receita
  FROM ids JOIN public.boletos b ON b.id=ids.id
    JOIN public.clientes c ON c.id=b.cliente_id
    LEFT JOIN latest r ON r.boleto_id=b.id
), valores AS MATERIALIZED (
  SELECT *, vencimento BETWEEN p_inicio AND p_fim AS em_periodo,
    data_recebida BETWEEN p_inicio AND p_fim AS recebido_periodo,
    round(previsto*fracao_receita,2) AS receita_futura,
    round(realizado*fracao_receita,2) AS receita_realizada,
    (NOT suspensa AND status='nao_pago' AND vencimento < p_hoje) AS vencido
  FROM base
), totais AS (
  SELECT coalesce(sum(previsto) FILTER (WHERE em_periodo),0) AS a_receber,
    coalesce(sum(realizado) FILTER (WHERE recebido_periodo),0) AS recebido,
    coalesce(sum(previsto) FILTER (WHERE em_periodo AND vencido),0) AS vencido,
    count(*) FILTER (WHERE em_periodo AND status='pendente_confirmacao') AS aguardando,
    coalesce(sum(receita_realizada) FILTER (WHERE recebido_periodo),0) AS receita_realizada,
    coalesce(sum(receita_futura) FILTER (WHERE em_periodo AND status<>'pago'),0) AS receita_futura,
    coalesce(sum(previsto) FILTER (WHERE status<>'pago' AND NOT suspensa AND vencimento BETWEEN p_hoje AND p_hoje+30),0) AS dias30,
    coalesce(sum(previsto) FILTER (WHERE status<>'pago' AND NOT suspensa AND vencimento BETWEEN p_hoje AND p_hoje+60),0) AS dias60,
    coalesce(sum(previsto) FILTER (WHERE status<>'pago' AND NOT suspensa AND vencimento BETWEEN p_hoje AND p_hoje+90),0) AS dias90
  FROM valores
), meses AS (
  SELECT to_char(date_trunc('month',coalesce(data_recebida,vencimento)), 'MM/YYYY') AS label,
    date_trunc('month',coalesce(data_recebida,vencimento)) AS mes,
    round(coalesce(sum(previsto) FILTER (WHERE em_periodo),0),2) AS previsto,
    round(coalesce(sum(realizado) FILTER (WHERE recebido_periodo),0),2) AS realizado,
    round(coalesce(sum(previsto) FILTER (WHERE em_periodo AND vencido),0),2) AS vencido,
    round(coalesce(sum(receita_realizada) FILTER (WHERE recebido_periodo),0),2) AS "receitaRealizada",
    round(coalesce(sum(receita_futura) FILTER (WHERE em_periodo AND status<>'pago'),0),2) AS "receitaFutura"
  FROM valores WHERE em_periodo OR recebido_periodo
  GROUP BY date_trunc('month',coalesce(data_recebida,vencimento))
)
SELECT jsonb_build_object(
  'periodo',jsonb_build_object('inicio',p_inicio,'fim',p_fim),
  'kpis',jsonb_build_object('aReceber',round(t.a_receber,2),'recebido',round(t.recebido,2),
    'vencido',round(t.vencido,2),'aguardandoValidacao',t.aguardando,
    'divergencias',NULL,'divergenciasDisponiveis',false,
    'receitaAdministrativaRealizada',round(t.receita_realizada,2),
    'receitaAdministrativaFutura',round(t.receita_futura,2)),
  'previsao',jsonb_build_object('dias30',round(t.dias30,2),'dias60',round(t.dias60,2),'dias90',round(t.dias90,2)),
  'evolucao',(SELECT coalesce(jsonb_agg(to_jsonb(m)-'mes' ORDER BY m.mes),'[]'::jsonb) FROM meses m),
  'ultimaAtualizacao',now(),'truncado',false
) FROM totais t;
$$;

CREATE OR REPLACE FUNCTION public.loadtest_finance_receivables_page(
  p_inicio date,p_fim date,p_status text,p_busca text,p_pagina integer,p_limite integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE resultado jsonb;
BEGIN
  IF p_pagina < 1 OR p_pagina > 100000 OR p_limite < 1 OR p_limite > 100 THEN
    RAISE EXCEPTION 'Paginacao invalida';
  END IF;
  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON (boleto_id) boleto_id,status_validacao,juros,multa,desconto,valor_recebido,
      forma_pagamento,origem_boleto,origem,instituicao_financeira,instituicao_conta,data_pagamento,
      comprovante_url,external_payment_id,external_reference,observacao
    FROM public.financeiro_recebimentos
    ORDER BY boleto_id,(status_validacao='validado') DESC,created_at DESC
  ), filtrados AS MATERIALIZED (
    SELECT b.id,b.cliente_id,b.numero_parcela,b.total_parcelas,b.valor,b.data_vencimento,
      b.status,b.comprovante_url,b.data_pagamento,b.observacoes,b.created_at,b.updated_at,b.suspensa,
      c.nome_completo,c.cpf,
      r.status_validacao,r.juros,r.multa,r.desconto,r.valor_recebido,r.forma_pagamento,
      r.origem_boleto,r.origem,r.instituicao_financeira,r.instituicao_conta,
      r.data_pagamento AS recebimento_data,r.comprovante_url AS recebimento_comprovante,
      r.external_payment_id,r.external_reference,r.observacao
    FROM public.boletos b JOIN public.clientes c ON c.id=b.cliente_id
      LEFT JOIN latest r ON r.boleto_id=b.id
    WHERE (b.data_vencimento BETWEEN p_inicio AND p_fim OR b.data_vencimento IS NULL)
      AND (p_status='todos' OR p_status=CASE WHEN b.suspensa THEN 'suspensa'
        WHEN b.status::text='nao_pago' AND b.data_vencimento < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'vencido'
        ELSE b.status::text END)
      AND (coalesce(p_busca,'')='' OR concat_ws(' ',c.nome_completo,c.cpf,
        b.numero_parcela::text||'/'||b.total_parcelas::text,r.external_payment_id) ILIKE '%' || p_busca || '%')
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtrados),
    'itens',(SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.data_vencimento,page.id),'[]'::jsonb)
      FROM (SELECT * FROM filtrados ORDER BY data_vencimento,id
        LIMIT p_limite OFFSET (p_pagina-1)*p_limite) page)) INTO resultado;
  RETURN resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.loadtest_finance_summary(date,date,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.loadtest_finance_receivables_page(date,date,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_finance_summary(date,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.loadtest_finance_receivables_page(date,date,text,text,integer,integer) TO service_role;
