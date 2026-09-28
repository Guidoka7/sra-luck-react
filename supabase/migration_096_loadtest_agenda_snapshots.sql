-- EXCLUSIVO DA BRANCH load-test-10k-isolated. Aplicar somente ao projeto
-- xqlxzdmleekbrietejoq; não migrar para o projeto de produção.
-- Agrega ocupação no Postgres sem enviar agendamentos de outras clientes
-- para a Edge. A regra de capacidade continua em agendar_data.
CREATE OR REPLACE FUNCTION public.loadtest_agenda_datas_snapshot(p_hoje date)
RETURNS TABLE(id uuid, data date, vagas_restantes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.id, d.data,
         GREATEST(0, d.vagas_totais - count(a.id)::integer) AS vagas_restantes
  FROM public.datas AS d
  LEFT JOIN public.agendamentos AS a
    ON a.data_id = d.id AND a.status = 'confirmado'
  WHERE d.status = 'disponivel' AND d.data >= p_hoje
  GROUP BY d.id, d.data, d.vagas_totais
  ORDER BY d.data;
$$;

CREATE OR REPLACE FUNCTION public.loadtest_agenda_cirurgia_datas_snapshot(p_hoje date)
RETURNS TABLE(id uuid, data date, vagas_restantes integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT d.id, d.data,
         GREATEST(0, d.vagas_totais - count(a.id)::integer) AS vagas_restantes
  FROM public.datas_liberacao_financeira AS d
  LEFT JOIN public.agendamentos AS a
    ON a.data_cirurgia = d.data AND a.status IN ('confirmado', 'realizado')
  WHERE d.status = 'disponivel' AND d.fechamento_manual = false AND d.data >= p_hoje
  GROUP BY d.id, d.data, d.vagas_totais
  ORDER BY d.data;
$$;

REVOKE ALL ON FUNCTION public.loadtest_agenda_datas_snapshot(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.loadtest_agenda_cirurgia_datas_snapshot(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_agenda_datas_snapshot(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.loadtest_agenda_cirurgia_datas_snapshot(date) TO service_role;

-- A autorização continua no Worker e é revalidada em toda requisição.
-- As regras financeiras são as funções já existentes; só se elimina o custo
-- de três viagens REST/RPC e se reduz as colunas das parcelas transportadas.
CREATE OR REPLACE FUNCTION public.loadtest_cliente_financeiro_snapshot(p_cliente_id uuid)
-- As três funções financeiras existentes usam tabelas não qualificadas.
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'boletos', (
      SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.numero_parcela), '[]'::jsonb)
      FROM (
        SELECT id,numero_parcela,total_parcelas,valor,data_vencimento,status,
               data_pagamento,comprovante_url,boleto_url
        FROM public.boletos WHERE cliente_id = p_cliente_id
        ORDER BY numero_parcela
      ) AS b
    ),
    'porcentagem_pagamento', public.porcentagem_pagamento(p_cliente_id),
    'pode_agendar', public.pode_agendar(p_cliente_id),
    'agenda_liberada', public.agenda_liberada(p_cliente_id)
  );
$$;
REVOKE ALL ON FUNCTION public.loadtest_cliente_financeiro_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_cliente_financeiro_snapshot(uuid) TO service_role;

-- O Preview isolado usa a chave anon e só contém dados fictícios. O grant
-- específico fica isolado no arquivo loadtest/isolated-rpc-grants.sql.
