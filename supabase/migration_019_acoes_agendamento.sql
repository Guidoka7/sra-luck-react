-- ============================================================================
-- migration_019_acoes_agendamento.sql
-- Ações diretas da Agenda de Termos: confirmar presença, reagendar e cancelar.
-- ============================================================================

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS presenca_confirmada_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_agendamentos_presenca_confirmada
  ON public.agendamentos (presenca_confirmada_em)
  WHERE presenca_confirmada_em IS NOT NULL;

CREATE OR REPLACE FUNCTION public.remarcar_agendamento_termos(
  p_agendamento_id uuid,
  p_data_id uuid,
  p_horario_termos text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento agendamentos%rowtype;
  v_data datas%rowtype;
BEGIN
  SELECT * INTO v_agendamento
  FROM agendamentos
  WHERE id = p_agendamento_id
  FOR UPDATE;

  IF NOT FOUND OR v_agendamento.status <> 'confirmado' THEN
    RAISE EXCEPTION USING errcode = 'P0010', message = 'AGENDAMENTO_NAO_DISPONIVEL';
  END IF;

  SELECT * INTO v_data
  FROM datas
  WHERE id = p_data_id
  FOR UPDATE;

  IF NOT FOUND OR v_data.status <> 'disponivel' THEN
    RAISE EXCEPTION USING errcode = 'P0011', message = 'DATA_INDISPONIVEL';
  END IF;

  IF p_horario_termos IS NULL OR p_horario_termos NOT IN
    ('09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30','16:00','16:30') THEN
    RAISE EXCEPTION USING errcode = 'P0012', message = 'HORARIO_INVALIDO';
  END IF;

  IF (
    SELECT count(*) FROM agendamentos
    WHERE data_id = p_data_id
      AND status = 'confirmado'
      AND id <> p_agendamento_id
  ) >= v_data.vagas_totais THEN
    RAISE EXCEPTION USING errcode = 'P0013', message = 'VAGAS_ESGOTADAS';
  END IF;

  UPDATE agendamentos
  SET data_id = p_data_id,
      horario_termos = p_horario_termos,
      presenca_confirmada_em = NULL,
      updated_at = now()
  WHERE id = p_agendamento_id;

  RETURN p_agendamento_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_agendamento(
  p_agendamento_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE agendamentos
  SET status = 'cancelado',
      presenca_confirmada_em = NULL,
      updated_at = now()
  WHERE id = p_agendamento_id
    AND status = 'confirmado';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0020', message = 'AGENDAMENTO_NAO_DISPONIVEL';
  END IF;

  RETURN p_agendamento_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirmar_presenca_agendamento(
  p_agendamento_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE agendamentos
  SET presenca_confirmada_em = now(),
      updated_at = now()
  WHERE id = p_agendamento_id
    AND status = 'confirmado';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0030', message = 'AGENDAMENTO_NAO_DISPONIVEL';
  END IF;

  RETURN p_agendamento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remarcar_agendamento_termos(uuid, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancelar_agendamento(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirmar_presenca_agendamento(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remarcar_agendamento_termos(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancelar_agendamento(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_presenca_agendamento(uuid) TO service_role;
