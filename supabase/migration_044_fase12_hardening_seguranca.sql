-- ============================================================================
-- migration_044_fase12_hardening_seguranca.sql
--
-- Fase 12: correções de segurança reportadas pelos advisors do Supabase.
-- Aditivo — apenas ALTER de propriedades existentes, sem DROP de dados.
-- ============================================================================

-- ERROR: view com SECURITY DEFINER implícito ignorava RLS de quem consulta.
-- security_invoker=on faz a view respeitar o RLS de quem chama, não do dono.
alter view public.vw_notificacoes_resumo set (security_invoker = on);

-- WARN: search_path mutável em funções é vetor clássico de schema-injection.
alter function public.vagas_ocupadas(uuid) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.orcamento_do_mes(integer, integer) set search_path = public;
alter function public.agenda_liberada(uuid) set search_path = public;
alter function public.porcentagem_pagamento(uuid) set search_path = public;
alter function public.pode_agendar(uuid) set search_path = public;
alter function public.sincronizar_revisao_financeira() set search_path = public;
alter function public.gerar_boletos_cliente(uuid, integer, numeric, date) set search_path = public;
alter function public.atualizar_solicitacao_liberacao_updated_at() set search_path = public;

-- WARN: gerar_comissao_sdr_comparecimento e rls_auto_enable eram chamáveis via
-- REST RPC por anon/authenticated sem necessidade — a geração de comissão só
-- deve ocorrer pelo fluxo do Worker (service_role) e rls_auto_enable só faz
-- sentido dentro do próprio event trigger. verificar_login_cliente é mantida
-- exposta a anon de propósito: é o mecanismo real de login da cliente
-- (CPF + data de nascimento) antes de existir sessão — não alterar.
revoke execute on function public.gerar_comissao_sdr_comparecimento(uuid, uuid) from public;
revoke execute on function public.rls_auto_enable() from public;
grant execute on function public.gerar_comissao_sdr_comparecimento(uuid, uuid) to service_role;
grant execute on function public.rls_auto_enable() to service_role;

-- INFO: dois pares de índices idênticos — remove o mais recente de cada par.
drop index if exists public.idx_agendamentos_status_data_id;
drop index if exists public.idx_unique_datas_liberacao_financeira_data;
