-- Exclusivo do Supabase isolado do ensaio. A Central devolve até 50 cartões
-- por fila, com cursor por (nome,id), sem transportar 10 mil IDs pela URL.
CREATE OR REPLACE FUNCTION public.loadtest_admin_central_snapshot(
  p_hoje date,
  p_limite integer DEFAULT 20,
  p_estagio text DEFAULT NULL,
  p_apos_nome text DEFAULT NULL,
  p_apos_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH base AS MATERIALIZED (
    SELECT c.id, c.nome_completo, a.id AS agendamento_id,
      CASE
        WHEN a.processo_concluido_em IS NOT NULL THEN NULL
        WHEN a.data_cirurgia IS NOT NULL THEN 'surgeryConfirmed'
        WHEN a.data_termos IS NOT NULL AND a.data_termos <= p_hoje THEN 'financialRelease'
        WHEN a.data_termos IS NOT NULL THEN 'termsConfirmed'
        WHEN c.liberacao_financeira_solicitada_em IS NOT NULL THEN 'financialReview'
        ELSE 'preEligibility'
      END AS estagio
    FROM public.clientes c
    LEFT JOIN LATERAL (
      SELECT a.id,a.data_cirurgia,a.processo_concluido_em,d.data AS data_termos
      FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
      WHERE a.cliente_id=c.id AND a.status IN ('confirmado','realizado')
      ORDER BY a.created_at DESC LIMIT 1
    ) a ON true
    WHERE c.ativo=true
  ),
  totais AS (
    SELECT coalesce(jsonb_object_agg(estagio,total),'{}'::jsonb) AS por_estagio
    FROM (SELECT estagio,count(*) AS total FROM base
      WHERE estagio IS NOT NULL GROUP BY estagio) t
  ),
  ranqueados AS (
    SELECT b.*,row_number() OVER (PARTITION BY b.estagio ORDER BY b.nome_completo,b.id) AS posicao
    FROM base b
    WHERE b.estagio IS NOT NULL
      AND (p_estagio IS NULL OR b.estagio=p_estagio)
      AND (p_apos_nome IS NULL OR (b.nome_completo,b.id)>(p_apos_nome,p_apos_id))
  ),
  pagina AS MATERIALIZED (
    SELECT * FROM ranqueados WHERE posicao<=greatest(1,least(coalesce(p_limite,20),50))
  ),
  cartoes AS (
    SELECT p.estagio,p.nome_completo,p.id,
      jsonb_build_object('cliente',to_jsonb(c),'agendamento',to_jsonb(a),
        'parcelas',jsonb_build_object('total',b.total,'pagas',b.pagas,'proxima',b.proxima),
        'solicitacao',to_jsonb(s)) AS dados
    FROM pagina p
    JOIN LATERAL (
      SELECT id,nome_completo,cpf,data_nascimento,procedimento,valor_contrato,
        quantidade_parcelas,status_revisao_financeira,financeiro_confirmado_em,
        data_atingiu_percentual,liberacao_financeira_solicitada_em,
        custeio_confirmado_em,status_cirurgia,ativo,acesso_app_liberado,
        acesso_app_liberado_em FROM public.clientes WHERE id=p.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT a.id,a.cliente_id,a.status,a.horario_termos,a.termos_assinados_em,
        a.termos_responsavel,a.comparecimento_status,a.comparecimento_em,
        a.quitacao_status,a.quitacao_em,a.previsao_cirurgia,
        a.previsao_cirurgia_confirmada_em,a.agenda_cirurgica_liberada_em,
        a.agenda_cirurgica_liberada_manualmente,a.agenda_cirurgica_prazo_ajuste_dias,
        a.data_cirurgia,a.horario_cirurgia,a.cirurgia_escolhida_em,
        a.valor_contrato,a.pagamento_cirurgia_confirmado_em,
        a.processo_concluido_em,a.created_at,d.data AS data_termos
      FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
      WHERE a.id=p.agendamento_id
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,count(*) FILTER (WHERE status='pago') AS pagas,
        min(data_vencimento) FILTER (WHERE status<>'pago') AS proxima
      FROM public.boletos WHERE cliente_id=p.id
    ) b ON true
    LEFT JOIN LATERAL (
      SELECT status,forma_custeio,saldo_restante
      FROM public.solicitacoes_liberacao_financeira
      WHERE cliente_id=p.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
  ),
  filas AS (
    SELECT coalesce(jsonb_object_agg(estagio,itens),'{}'::jsonb) AS por_estagio
    FROM (SELECT estagio,jsonb_agg(dados ORDER BY nome_completo,id) AS itens
      FROM cartoes GROUP BY estagio) f
  )
  SELECT jsonb_build_object('filas',filas.por_estagio,'totais',totais.por_estagio)
  FROM filas,totais;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_central_snapshot(date,integer,text,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_central_snapshot(date,integer,text,text,uuid)
  TO service_role;
