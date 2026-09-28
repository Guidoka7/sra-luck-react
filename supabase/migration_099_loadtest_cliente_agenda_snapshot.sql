-- Somente na branch de carga. Aplicar ao projeto isolado xqlxzdmleekbrietejoq.
-- Mantém as funções de elegibilidade, disponibilidade e teto mensal existentes.
CREATE OR REPLACE FUNCTION public.loadtest_cliente_agenda_snapshot(
  p_cliente_id uuid, p_hoje date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_agendamentos jsonb;
  v_agendamento_id uuid;
  v_cirurgica_id uuid;
  v_solicitacao jsonb;
  v_remarcacoes jsonb := '[]'::jsonb;
  v_datas_cirurgia jsonb := '[]'::jsonb;
  v_minima date;
  v_comprometimento jsonb := '{}'::jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(linha) - 'created_at_ord' ORDER BY linha.created_at_ord DESC),'[]'::jsonb)
    INTO v_agendamentos FROM (
      SELECT a.id,a.data_id,a.status,a.horario_termos,a.termos_assinados_em,
        a.comparecimento_status,a.comparecimento_em,a.quitacao_status,a.quitacao_em,
        a.previsao_cirurgia,a.previsao_cirurgia_confirmada_em,a.data_cirurgia,
        a.horario_cirurgia,a.valor_contrato,a.agenda_cirurgica_liberada_em,
        a.created_at,a.created_at AS created_at_ord,
        jsonb_build_object('data',d.data) AS datas
      FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
      WHERE a.cliente_id=p_cliente_id AND a.status IN ('confirmado','realizado')
    ) linha;

  SELECT a.id INTO v_agendamento_id FROM public.agendamentos a
    WHERE a.cliente_id=p_cliente_id AND a.status IN ('confirmado','realizado')
    ORDER BY (a.status='confirmado') DESC,a.created_at DESC LIMIT 1;
  SELECT a.id INTO v_cirurgica_id FROM public.agendamentos a
    WHERE a.id=v_agendamento_id AND a.agenda_cirurgica_liberada_em IS NOT NULL
      AND a.data_cirurgia IS NULL;

  SELECT to_jsonb(linha) INTO v_solicitacao FROM (
    SELECT id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,
      status,observacao,agendamento_id,created_at,updated_at
    FROM public.solicitacoes_liberacao_financeira
    WHERE cliente_id=p_cliente_id ORDER BY created_at DESC LIMIT 1
  ) linha;

  IF v_agendamento_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(linha) - 'created_at_ord' ORDER BY linha.created_at_ord DESC),'[]'::jsonb)
      INTO v_remarcacoes FROM (
        SELECT id,tipo,status,data_solicitada,horario_termos,observacao,
          created_at,updated_at,created_at AS created_at_ord
        FROM public.solicitacoes_remarcacao_agendamento
        WHERE cliente_id=p_cliente_id AND agendamento_id=v_agendamento_id
      ) linha;
  END IF;

  IF v_cirurgica_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(linha) ORDER BY linha.data),'[]'::jsonb)
      INTO v_datas_cirurgia
    FROM public.loadtest_agenda_cirurgia_datas_snapshot(p_hoje) linha;
    SELECT public.agenda_data_minima_cirurgia(v_cirurgica_id) INTO v_minima;
    SELECT coalesce(jsonb_object_agg(mes,valor),'{}'::jsonb)
      INTO v_comprometimento FROM (
        SELECT to_char(m.inicio,'YYYY-MM') AS mes,
          public.agenda_comprometimento_mes(m.inicio,p_cliente_id) AS valor
        FROM (
          SELECT DISTINCT date_trunc('month',(item->>'data')::date)::date AS inicio
          FROM jsonb_array_elements(v_datas_cirurgia) item
        ) m
      ) mensal;
  END IF;

  RETURN jsonb_build_object(
    'agendamentos',v_agendamentos,
    'elegivel',public.pode_agendar(p_cliente_id),
    'solicitacao',v_solicitacao,
    'remarcacoes',v_remarcacoes,
    'datas_disponiveis',(
      SELECT coalesce(jsonb_agg(to_jsonb(linha) ORDER BY linha.data),'[]'::jsonb)
      FROM public.loadtest_agenda_datas_snapshot(p_hoje) linha
    ),
    'datas_cirurgia',v_datas_cirurgia,
    'data_minima',v_minima,
    'comprometido_por_mes',v_comprometimento
  );
END;
$$;

REVOKE ALL ON FUNCTION public.loadtest_cliente_agenda_snapshot(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_cliente_agenda_snapshot(uuid,date) TO service_role;
