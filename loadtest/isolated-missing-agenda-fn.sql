-- Somente xqlxzdmleekbrietejoq. O provisionamento sintético omitiu esta
-- função existente em migration_070; manter a mesma lógica para um ensaio fiel.
CREATE OR REPLACE FUNCTION public.agenda_comprometimento_mes(
  p_mes date, p_excluir_cliente uuid DEFAULT null
)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  WITH candidatos AS (
    SELECT a.cliente_id,
      coalesce(a.valor_contrato_comprometido, c.valor_contrato) AS valor_comprometido,
      CASE WHEN a.data_cirurgia IS NOT NULL THEN a.data_cirurgia
           WHEN a.previsao_cirurgia_confirmada_em IS NOT NULL THEN a.previsao_cirurgia
           ELSE NULL END AS data_compromisso,
      (a.data_cirurgia IS NOT NULL) AS final,
      coalesce(a.cirurgia_escolhida_em,a.previsao_cirurgia_confirmada_em,a.updated_at,a.created_at) AS marco
    FROM public.agendamentos a
    JOIN public.clientes c ON c.id = a.cliente_id
    WHERE a.status IN ('confirmado','realizado')
      AND (a.data_cirurgia IS NOT NULL OR a.previsao_cirurgia_confirmada_em IS NOT NULL)
      AND (p_excluir_cliente IS NULL OR a.cliente_id <> p_excluir_cliente)
  ), unicos AS (
    SELECT DISTINCT ON (cliente_id) cliente_id,valor_comprometido,data_compromisso
    FROM candidatos WHERE data_compromisso IS NOT NULL
    ORDER BY cliente_id,final DESC,marco DESC
  )
  SELECT coalesce(sum(valor_comprometido),0)::numeric
  FROM unicos
  WHERE date_trunc('month',data_compromisso)::date = date_trunc('month',p_mes)::date;
$$;

REVOKE ALL ON FUNCTION public.agenda_comprometimento_mes(date,uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_comprometimento_mes(date,uuid) TO service_role;
-- Somente o Preview isolado usa a chave anon e seus dados são fictícios.
GRANT EXECUTE ON FUNCTION public.agenda_comprometimento_mes(date,uuid) TO anon;
