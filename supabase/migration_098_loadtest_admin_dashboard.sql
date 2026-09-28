-- EXCLUSIVO do ensaio isolado. Nenhuma função desta branch vai para a main.
-- Resumo financeiro e operacional, sem transportar 120 mil parcelas para a Edge.
CREATE OR REPLACE FUNCTION public.loadtest_admin_dashboard_stats(
  p_hoje date, p_inicio date, p_fim date,
  p_semana_inicio date, p_semana_fim date,
  p_grafico_inicio date, p_grafico_fim date
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH clientes_stats AS (
    SELECT count(*) FILTER (WHERE coalesce(status_contrato::text,'ativo')='ativo') AS ativas,
      count(*) FILTER (WHERE status_contrato::text='suspenso') AS suspensas,
      count(*) FILTER (WHERE status_contrato::text='negativado') AS negativadas,
      count(*) FILTER (WHERE status_contrato::text='cancelado') AS canceladas,
      count(*) FILTER (WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date=p_hoje) AS novas_hoje,
      coalesce(sum(valor_contrato) FILTER (WHERE coalesce(status_contrato::text,'ativo')='ativo'),0) AS valor_ativo
    FROM public.clientes
  ),
  boletos_stats AS (
    SELECT count(*) AS total,
      count(*) FILTER (WHERE status <> 'pago') AS abertos,
      count(*) FILTER (WHERE status <> 'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje) AS vencidos,
      count(*) FILTER (WHERE status='pendente_confirmacao') AS conferencia,
      count(*) FILTER (WHERE status <> 'pago' AND data_vencimento IS NULL) AS sem_vencimento,
      count(*) FILTER (WHERE status='pago' AND data_pagamento>=p_inicio AND data_pagamento<p_fim) AS pagos_mes,
      count(*) FILTER (WHERE status='pago' AND data_pagamento>=p_semana_inicio AND data_pagamento<p_semana_fim) AS pagos_semana,
      coalesce(sum(valor) FILTER (WHERE status <> 'pago'),0) AS valor_aberto,
      coalesce(sum(valor) FILTER (WHERE status <> 'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje),0) AS valor_vencido,
      coalesce(sum(valor) FILTER (WHERE status='pago' AND data_pagamento>=p_inicio AND data_pagamento<p_fim),0) AS valor_mes,
      coalesce(sum(valor) FILTER (WHERE status='pago' AND data_pagamento>=p_semana_inicio AND data_pagamento<p_semana_fim),0) AS valor_semana
    FROM public.boletos
  ),
  inadimplentes AS (
    SELECT count(DISTINCT cliente_id) AS total FROM public.boletos
    WHERE status <> 'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje
  ),
  prontos AS (
    SELECT count(*) AS total FROM public.clientes c
    WHERE NOT coalesce(c.acesso_app_liberado,false)
      AND c.nome_completo IS NOT NULL AND c.nome_completo <> ''
      AND regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g') ~ '^[0-9]{11}$'
      AND c.data_nascimento IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.boletos b WHERE b.cliente_id=c.id)
  ),
  recentes AS (
    SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC),'[]'::jsonb) AS itens
    FROM (SELECT id,nome_completo,cpf,created_at,status_contrato
      FROM public.clientes ORDER BY created_at DESC LIMIT 6) c
  ),
  revisoes AS (
    SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC),'[]'::jsonb) AS itens
    FROM (SELECT p.id,p.nome_completo,p.valor_contrato,p.quantidade_parcelas,p.created_at,
      b.total AS parcelas_total,b.pagas AS parcelas_pagas
      FROM (SELECT id,nome_completo,valor_contrato,quantidade_parcelas,created_at
        FROM public.clientes WHERE status_revisao_financeira='pendente'
        ORDER BY created_at DESC LIMIT 8) p
      LEFT JOIN LATERAL (SELECT count(*) AS total,count(*) FILTER (WHERE status='pago') AS pagas
        FROM public.boletos WHERE cliente_id=p.id) b ON true) c
  ),
  comprovantes AS (
    SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.data_vencimento ASC NULLS LAST),'[]'::jsonb) AS itens
    FROM (SELECT b.id,b.cliente_id,b.numero_parcela,b.total_parcelas,b.valor,b.data_pagamento,b.data_vencimento,c.nome_completo
      FROM public.boletos b LEFT JOIN public.clientes c ON c.id=b.cliente_id
      WHERE b.status='pendente_confirmacao'
      ORDER BY b.data_vencimento ASC NULLS LAST LIMIT 8) b
  ),
  grafico AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('mes',to_char(m.mes,'YYYY-MM'),
      'previsto',coalesce(prev.valor,0),'recebido',coalesce(rec.valor,0),'vencido',coalesce(venc.valor,0))
      ORDER BY m.mes),'[]'::jsonb) AS itens
    FROM generate_series(p_grafico_inicio::timestamp,(p_grafico_fim-interval '1 day')::timestamp,interval '1 month') m(mes)
    LEFT JOIN (SELECT date_trunc('month',data_vencimento)::date mes,sum(valor) valor FROM public.boletos
      WHERE data_vencimento>=p_grafico_inicio AND data_vencimento<p_grafico_fim GROUP BY 1) prev ON prev.mes=m.mes::date
    LEFT JOIN (SELECT date_trunc('month',data_pagamento)::date mes,sum(valor) valor FROM public.boletos
      WHERE status='pago' AND data_pagamento>=p_grafico_inicio AND data_pagamento<p_grafico_fim GROUP BY 1) rec ON rec.mes=m.mes::date
    LEFT JOIN (SELECT date_trunc('month',data_vencimento)::date mes,sum(valor) valor FROM public.boletos
      WHERE status<>'pago' AND NOT coalesce(suspensa,false) AND data_vencimento<p_hoje
        AND data_vencimento>=p_grafico_inicio AND data_vencimento<p_grafico_fim GROUP BY 1) venc ON venc.mes=m.mes::date
  ),
  dispositivos AS (
    SELECT count(*) total,
      count(*) FILTER (WHERE is_pwa_installed=true) instalados,
      count(*) FILTER (WHERE last_access_at IS NULL OR last_access_at<now()-interval '7 days') sem_acesso
    FROM public.cliente_app_devices
  ),
  novas_vendas AS (SELECT count(*) total FROM public.novas_vendas WHERE status='aguardando_cadastro'),
  notificacoes AS (SELECT count(*) total FROM public.notificacao_logs
    WHERE created_at >= (p_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND created_at < ((p_hoje+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND push_enviadas>0),
  vapid AS (SELECT count(DISTINCT chave) FILTER (WHERE chave IN ('vapid_public_key','vapid_private_key','vapid_subject'))=3 AS configurado
    FROM public.integracoes_credenciais WHERE provedor='web_push' AND ativo=true),
  atividade AS (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC),'[]'::jsonb) AS itens
    FROM (SELECT usuario,acao,entidade,created_at FROM public.logs_alteracoes ORDER BY created_at DESC LIMIT 8) l)
  SELECT jsonb_build_object(
    'clientes',to_jsonb(c),'boletos',to_jsonb(b)||jsonb_build_object('inadimplentes',i.total),
    'clientesProntasAcessoApp',p.total,'novasClientesRecentes',r.itens,
    'clientesAguardandoLiberacao',rv.itens,'comprovantesPendentes',cp.itens,
    'financeiroMensal',g.itens,'dispositivos',to_jsonb(d),
    'novasVendas',nv.total,'notificacoesHoje',nf.total,
    'webPushConfigurado',v.configurado,'atividadeRecente',a.itens
  ) FROM clientes_stats c,boletos_stats b,inadimplentes i,prontos p,recentes r,revisoes rv,
    comprovantes cp,grafico g,dispositivos d,novas_vendas nv,notificacoes nf,vapid v,atividade a;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_dashboard_stats(date,date,date,date,date,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_dashboard_stats(date,date,date,date,date,date,date) TO service_role;

-- Eventos da tela: mês e próximos sete dias em uma viagem. Limite explícito
-- de 1000 em cada lista, equivalente ao limite anterior do PostgREST.
CREATE OR REPLACE FUNCTION public.loadtest_admin_dashboard_agenda(
  p_inicio date,p_fim date,p_hoje date,p_proximos_fim date
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH termos AS MATERIALIZED (
    SELECT a.id,a.cliente_id,a.status,a.horario_termos,a.termos_assinados_em,
      a.created_at,d.data,c.nome_completo,c.status_financeiro,c.status_cirurgia
    FROM public.agendamentos a
    JOIN public.datas d ON d.id=a.data_id
    LEFT JOIN public.clientes c ON c.id=a.cliente_id
    WHERE a.status IN ('confirmado','realizado') AND
      ((d.data>=p_inicio AND d.data<p_fim) OR (d.data>=p_hoje AND d.data<p_proximos_fim))
  ),
  cirurgias AS MATERIALIZED (
    SELECT a.id,a.cliente_id,a.status,a.data_cirurgia,
      c.nome_completo,c.status_financeiro,c.status_cirurgia
    FROM public.agendamentos a
    LEFT JOIN public.clientes c ON c.id=a.cliente_id
    WHERE a.status IN ('confirmado','realizado') AND
      ((a.data_cirurgia>=p_inicio AND a.data_cirurgia<p_fim)
        OR (a.data_cirurgia>=p_hoje AND a.data_cirurgia<p_proximos_fim))
  ),
  termos_mes AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'cliente_id',t.cliente_id,'status',t.status,
      'horario_termos',t.horario_termos,'termos_assinados_em',t.termos_assinados_em,
      'datas',jsonb_build_object('data',t.data),
      'clientes',jsonb_build_object('id',t.cliente_id,'nome_completo',t.nome_completo,
        'status_financeiro',t.status_financeiro,'status_cirurgia',t.status_cirurgia))
      ORDER BY t.created_at),'[]'::jsonb) AS itens FROM
      (SELECT * FROM termos WHERE data>=p_inicio AND data<p_fim ORDER BY created_at LIMIT 1000) t
  ),
  termos_proximos AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'cliente_id',t.cliente_id,'status',t.status,
      'horario_termos',t.horario_termos,'termos_assinados_em',t.termos_assinados_em,
      'datas',jsonb_build_object('data',t.data),
      'clientes',jsonb_build_object('id',t.cliente_id,'nome_completo',t.nome_completo,
        'status_financeiro',t.status_financeiro,'status_cirurgia',t.status_cirurgia))
      ORDER BY t.created_at),'[]'::jsonb) AS itens FROM
      (SELECT * FROM termos WHERE data>=p_hoje AND data<p_proximos_fim ORDER BY created_at LIMIT 1000) t
  ),
  cirurgias_mes AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cliente_id',s.cliente_id,'status',s.status,
      'data_cirurgia',s.data_cirurgia,'clientes',jsonb_build_object('id',s.cliente_id,
        'nome_completo',s.nome_completo,'status_financeiro',s.status_financeiro,
        'status_cirurgia',s.status_cirurgia)) ORDER BY s.data_cirurgia),'[]'::jsonb) AS itens FROM
      (SELECT * FROM cirurgias WHERE data_cirurgia>=p_inicio AND data_cirurgia<p_fim
        ORDER BY data_cirurgia LIMIT 1000) s
  ),
  cirurgias_proximas AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'cliente_id',s.cliente_id,'status',s.status,
      'data_cirurgia',s.data_cirurgia,'clientes',jsonb_build_object('id',s.cliente_id,
        'nome_completo',s.nome_completo,'status_financeiro',s.status_financeiro,
        'status_cirurgia',s.status_cirurgia)) ORDER BY s.data_cirurgia),'[]'::jsonb) AS itens FROM
      (SELECT * FROM cirurgias WHERE data_cirurgia>=p_hoje AND data_cirurgia<p_proximos_fim
        ORDER BY data_cirurgia LIMIT 1000) s
  )
  SELECT jsonb_build_object('termosMes',tm.itens,'termosProximos',tp.itens,
    'cirurgiasMes',cm.itens,'cirurgiasProximas',cp.itens)
  FROM termos_mes tm,termos_proximos tp,cirurgias_mes cm,cirurgias_proximas cp;
$$;
REVOKE ALL ON FUNCTION public.loadtest_admin_dashboard_agenda(date,date,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.loadtest_admin_dashboard_agenda(date,date,date,date) TO service_role;
