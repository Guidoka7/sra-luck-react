-- EXCLUSIVO DE load-test-10k-isolated, projeto xqlxzdmleekbrietejoq.
-- Evidência: EXPLAIN ANALYZE de 51 clientes ativos ordenados exigia Seq Scan
-- de 10.000 linhas e sort (26,9 ms frio). Índice alinha filtro + cursor.
CREATE INDEX IF NOT EXISTS idx_loadtest_clientes_ativos_recent
  ON public.clientes (created_at DESC,id DESC) WHERE ativo = true;

-- Admin autorizado no Worker. Busca, funil e paginação ficam no Postgres;
-- agregados das parcelas só são calculados para até 50 clientes da página.
CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_pagina(
  p_limite integer,
  p_cursor_created timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_funil text DEFAULT 'cadastradas',
  p_status text DEFAULT NULL,
  p_periodo_inicio timestamptz DEFAULT NULL,
  p_banco text DEFAULT NULL,
  p_sort text DEFAULT 'recent',
  p_cursor_name text DEFAULT NULL
)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public,pg_temp AS $$
  WITH pagina AS MATERIALIZED (
    SELECT c.id,c.nome_completo,c.cpf,c.data_nascimento,c.telefone,c.email,
      c.procedimento,c.medico,c.hospital,c.consultora,c.valor_contrato,
      c.taxa_administrativa_percentual,c.status_cirurgia,c.status_financeiro,
      c.observacoes_internas,c.quantidade_parcelas,c.status_revisao_financeira,
      c.data_atingiu_percentual,c.observacao_revisao_financeira,
      c.financeiro_saldo_restante,c.financeiro_taxa_cartao,c.financeiro_total_com_taxa,
      c.financeiro_formas_custeio,c.financeiro_confirmado_em,c.custeio_confirmado_em,
      c.ativo,c.status_contrato,c.suspenso_desde,c.suspenso_ate,c.suspensao_motivo,
      c.vendedora_id,c.acesso_app_liberado,c.acesso_app_liberado_em,c.inicio_plano,
      c.forma_pagamento_plano,c.instituicao_pagamento,c.dia_cobranca,c.status_plano,
      c.valor_total_plano,c.valor_parcela_plano,c.created_at,c.updated_at
    FROM public.clientes c
    WHERE c.ativo = true
      AND (p_cursor_id IS NULL OR
        (p_sort = 'recent' AND (c.created_at,c.id) < (p_cursor_created,p_cursor_id)) OR
        (p_sort = 'old' AND (c.created_at,c.id) > (p_cursor_created,p_cursor_id)) OR
        (p_sort = 'az' AND (lower(coalesce(c.nome_completo,'')),c.id) > (p_cursor_name,p_cursor_id)) OR
        (p_sort = 'za' AND (lower(coalesce(c.nome_completo,'')),c.id) < (p_cursor_name,p_cursor_id)))
      AND (p_periodo_inicio IS NULL OR c.created_at >= p_periodo_inicio)
      AND (p_status IS NULL OR coalesce(c.status_contrato::text,'ativo') = p_status)
      AND (
        p_funil = 'canceladas' AND c.status_contrato = 'cancelado'
        OR p_funil = 'aguardando' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
        OR p_funil = 'cadastradas' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
      )
      AND (p_busca IS NULL OR c.nome_completo ILIKE '%'||p_busca||'%'
        OR c.cpf ILIKE '%'||p_busca||'%' OR c.telefone ILIKE '%'||p_busca||'%'
        OR c.consultora ILIKE '%'||p_busca||'%'
        OR EXISTS (SELECT 1 FROM public.novas_vendas v WHERE v.cliente_id=c.id AND v.origem_venda ILIKE '%'||p_busca||'%')
        OR EXISTS (SELECT 1 FROM public.carnes n WHERE n.cliente_id=c.id AND n.instituicao_financeira ILIKE '%'||p_busca||'%'))
      AND (p_banco IS NULL OR (
        SELECT n.instituicao_financeira FROM public.carnes n
        WHERE n.cliente_id=c.id AND n.instituicao_financeira IS NOT NULL
        ORDER BY n.data_geracao DESC LIMIT 1
      ) = p_banco)
    ORDER BY
      CASE WHEN p_sort='recent' THEN c.created_at END DESC,
      CASE WHEN p_sort='old' THEN c.created_at END ASC,
      CASE WHEN p_sort='az' THEN lower(coalesce(c.nome_completo,'')) END ASC,
      CASE WHEN p_sort='za' THEN lower(coalesce(c.nome_completo,'')) END DESC,
      CASE WHEN p_sort IN ('recent','za') THEN c.id END DESC,
      CASE WHEN p_sort IN ('old','az') THEN c.id END ASC
    LIMIT LEAST(GREATEST(p_limite,1),50)+1
  )
  SELECT to_jsonb(c)
    || jsonb_build_object(
      'porcentagem_pagamento',CASE WHEN b.total>0 THEN round(b.pagos::numeric/b.total*100,1) ELSE NULL END,
      'parcelas_pagas',CASE WHEN b.total>0 THEN b.pagos ELSE NULL END,
      'parcelas_total',CASE WHEN b.total>0 THEN b.total ELSE NULL END,
      'termos_assinados_em',a.termos_assinados_em,
      'proximo_agendamento_data',CASE WHEN a.status='confirmado' THEN a.data ELSE NULL END,
      'proximo_agendamento_horario',CASE WHEN a.status='confirmado' THEN a.horario ELSE NULL END,
      'banco',n.instituicao_financeira,
      'origem_venda',v.origem_venda
    )
  FROM pagina c
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total,count(*) FILTER (WHERE status='pago')::integer AS pagos
    FROM public.boletos WHERE cliente_id=c.id
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT a.status::text AS status,d.data,a.termos_assinados_em,
      left(a.horario_termos::text,5) AS horario
    FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
    WHERE a.cliente_id=c.id AND a.status IN ('confirmado','realizado')
    ORDER BY (a.status='realizado') DESC,a.created_at DESC LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT instituicao_financeira FROM public.carnes
    WHERE cliente_id=c.id AND instituicao_financeira IS NOT NULL
    ORDER BY data_geracao DESC LIMIT 1
  ) n ON true
  LEFT JOIN LATERAL (
    SELECT origem_venda FROM public.novas_vendas
    WHERE cliente_id=c.id AND origem_venda IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  ) v ON true
  ORDER BY
    CASE WHEN p_sort='recent' THEN c.created_at END DESC,
    CASE WHEN p_sort='old' THEN c.created_at END ASC,
    CASE WHEN p_sort='az' THEN lower(coalesce(c.nome_completo,'')) END ASC,
    CASE WHEN p_sort='za' THEN lower(coalesce(c.nome_completo,'')) END DESC,
    CASE WHEN p_sort IN ('recent','za') THEN c.id END DESC,
    CASE WHEN p_sort IN ('old','az') THEN c.id END ASC;
$$;

REVOKE ALL ON FUNCTION public.loadtest_admin_clientes_pagina(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_pagina(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) TO service_role;

-- O sort padrão mantém o Index Scan com cursor; as demais ordenações
-- usam a variante geral e não penalizam o tráfego mais frequente.
CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_pagina_recent(
  p_limite integer,
  p_cursor_created timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_funil text DEFAULT 'cadastradas',
  p_status text DEFAULT NULL,
  p_periodo_inicio timestamptz DEFAULT NULL,
  p_banco text DEFAULT NULL,
  p_sort text DEFAULT 'recent',
  p_cursor_name text DEFAULT NULL
)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public,pg_temp AS $$
  WITH pagina AS MATERIALIZED (
    SELECT c.id,c.nome_completo,c.cpf,c.data_nascimento,c.telefone,c.email,
      c.procedimento,c.medico,c.hospital,c.consultora,c.valor_contrato,
      c.taxa_administrativa_percentual,c.status_cirurgia,c.status_financeiro,
      c.observacoes_internas,c.quantidade_parcelas,c.status_revisao_financeira,
      c.data_atingiu_percentual,c.observacao_revisao_financeira,
      c.financeiro_saldo_restante,c.financeiro_taxa_cartao,c.financeiro_total_com_taxa,
      c.financeiro_formas_custeio,c.financeiro_confirmado_em,c.custeio_confirmado_em,
      c.ativo,c.status_contrato,c.suspenso_desde,c.suspenso_ate,c.suspensao_motivo,
      c.vendedora_id,c.acesso_app_liberado,c.acesso_app_liberado_em,c.inicio_plano,
      c.forma_pagamento_plano,c.instituicao_pagamento,c.dia_cobranca,c.status_plano,
      c.valor_total_plano,c.valor_parcela_plano,c.created_at,c.updated_at
    FROM public.clientes c
    WHERE c.ativo = true
      AND (p_cursor_id IS NULL OR (c.created_at,c.id) < (p_cursor_created,p_cursor_id))
      AND (p_periodo_inicio IS NULL OR c.created_at >= p_periodo_inicio)
      AND (p_status IS NULL OR coalesce(c.status_contrato::text,'ativo') = p_status)
      AND (
        p_funil = 'canceladas' AND c.status_contrato = 'cancelado'
        OR p_funil = 'aguardando' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
        OR p_funil = 'cadastradas' AND c.status_contrato IS DISTINCT FROM 'cancelado'
          AND EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
      )
      AND (p_busca IS NULL OR c.nome_completo ILIKE '%'||p_busca||'%'
        OR c.cpf ILIKE '%'||p_busca||'%' OR c.telefone ILIKE '%'||p_busca||'%'
        OR c.consultora ILIKE '%'||p_busca||'%'
        OR EXISTS (SELECT 1 FROM public.novas_vendas v WHERE v.cliente_id=c.id AND v.origem_venda ILIKE '%'||p_busca||'%')
        OR EXISTS (SELECT 1 FROM public.carnes n WHERE n.cliente_id=c.id AND n.instituicao_financeira ILIKE '%'||p_busca||'%'))
      AND (p_banco IS NULL OR (
        SELECT n.instituicao_financeira FROM public.carnes n
        WHERE n.cliente_id=c.id AND n.instituicao_financeira IS NOT NULL
        ORDER BY n.data_geracao DESC LIMIT 1
      ) = p_banco)
    ORDER BY c.created_at DESC,c.id DESC
    LIMIT LEAST(GREATEST(p_limite,1),50)+1
  )
  SELECT to_jsonb(c)
    || jsonb_build_object(
      'porcentagem_pagamento',CASE WHEN b.total>0 THEN round(b.pagos::numeric/b.total*100,1) ELSE NULL END,
      'parcelas_pagas',CASE WHEN b.total>0 THEN b.pagos ELSE NULL END,
      'parcelas_total',CASE WHEN b.total>0 THEN b.total ELSE NULL END,
      'termos_assinados_em',a.termos_assinados_em,
      'proximo_agendamento_data',CASE WHEN a.status='confirmado' THEN a.data ELSE NULL END,
      'proximo_agendamento_horario',CASE WHEN a.status='confirmado' THEN a.horario ELSE NULL END,
      'banco',n.instituicao_financeira,
      'origem_venda',v.origem_venda
    )
  FROM pagina c
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS total,count(*) FILTER (WHERE status='pago')::integer AS pagos
    FROM public.boletos WHERE cliente_id=c.id
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT a.status::text AS status,d.data,a.termos_assinados_em,
      left(a.horario_termos::text,5) AS horario
    FROM public.agendamentos a LEFT JOIN public.datas d ON d.id=a.data_id
    WHERE a.cliente_id=c.id AND a.status IN ('confirmado','realizado')
    ORDER BY (a.status='realizado') DESC,a.created_at DESC LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT instituicao_financeira FROM public.carnes
    WHERE cliente_id=c.id AND instituicao_financeira IS NOT NULL
    ORDER BY data_geracao DESC LIMIT 1
  ) n ON true
  LEFT JOIN LATERAL (
    SELECT origem_venda FROM public.novas_vendas
    WHERE cliente_id=c.id AND origem_venda IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  ) v ON true
  ORDER BY c.created_at DESC,c.id DESC;
$$;

REVOKE ALL ON FUNCTION public.loadtest_admin_clientes_pagina_recent(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_pagina_recent(integer,timestamptz,uuid,text,text,text,timestamptz,text,text,text) TO service_role;

-- Contadores globais são separados da página: trocar de página não os recalcula.
CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_totais()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'aguardando',count(*) FILTER (WHERE c.status_contrato IS DISTINCT FROM 'cancelado' AND b.cliente_id IS NULL),
    'cadastradas',count(*) FILTER (WHERE c.status_contrato IS DISTINCT FROM 'cancelado' AND b.cliente_id IS NOT NULL),
    'canceladas',count(*) FILTER (WHERE c.status_contrato='cancelado')
  ) FROM public.clientes c
  LEFT JOIN (SELECT DISTINCT cliente_id FROM public.boletos) b ON b.cliente_id=c.id
  WHERE c.ativo=true;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_clientes_totais() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_totais() TO service_role;

-- Pequeno catálogo global para o filtro: não depende da página carregada.
CREATE OR REPLACE FUNCTION public.loadtest_admin_clientes_bancos()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(nome ORDER BY nome),'[]'::jsonb)
  FROM (SELECT DISTINCT instituicao_financeira AS nome FROM public.carnes
    WHERE instituicao_financeira IS NOT NULL AND btrim(instituicao_financeira) <> '') bancos;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_clientes_bancos() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_clientes_bancos() TO service_role;
