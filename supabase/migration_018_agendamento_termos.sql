DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'status_agendamento' AND e.enumlabel = 'realizado'
  ) THEN
    ALTER TYPE status_agendamento ADD VALUE 'realizado';
  END IF;
END $$;

ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS horario_termos time,
  ADD COLUMN IF NOT EXISTS termos_assinados_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_agendamentos_status_data
  ON public.agendamentos (status, data_id);

CREATE INDEX IF NOT EXISTS idx_agendamentos_horario_termos
  ON public.agendamentos (horario_termos)
  WHERE status = 'confirmado';
