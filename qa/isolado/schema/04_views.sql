create or replace view public.vw_notificacoes_resumo with (security_invoker=on) as  SELECT date(created_at) AS data,
    tipo,
    count(*) AS total,
    count(*) FILTER (WHERE (status = 'enviada'::text)) AS enviadas,
    count(*) FILTER (WHERE (status = 'falha'::text)) AS falhas,
    round((((count(*) FILTER (WHERE (status = 'enviada'::text)))::numeric / (NULLIF(count(*), 0))::numeric) * (100)::numeric), 1) AS taxa_sucesso
   FROM notificacao_agendadas
  GROUP BY (date(created_at)), tipo
  ORDER BY (date(created_at)) DESC;;
