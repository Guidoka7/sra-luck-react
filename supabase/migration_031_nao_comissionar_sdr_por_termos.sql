-- ============================================================================
-- migration_031_nao_comissionar_sdr_por_termos.sql
-- A tabela `agendamentos` atual representa a agenda operacional de termos.
-- A comissão SDR de R$ 10 é de comparecimento em agendamento comercial
-- qualificado, não de assinatura de termos. Portanto, não gerar comissão SDR
-- a partir desta tabela até existir a origem canônica do compromisso comercial.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_comissao_sdr_comparecimento_agendamento ON public.agendamentos;
DROP FUNCTION IF EXISTS public.gerar_comissao_sdr_comparecimento_agendamento();
