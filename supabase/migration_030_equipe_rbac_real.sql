-- ============================================================================
-- migration_030_equipe_rbac_real.sql
-- Consolida o modelo real de colaboradores/equipe sem depender de role no frontend.
-- Compatível com bases que ainda possuem as colunas históricas `perfil`/`perfis`.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cargo_colaborador') THEN
    CREATE TYPE cargo_colaborador AS ENUM ('vendedora', 'sdr', 'financeiro', 'administrativo');
  END IF;
END $$;

ALTER TABLE colaboradores
  ADD COLUMN IF NOT EXISTS cargo cargo_colaborador;

ALTER TABLE colaboradores
  ADD COLUMN IF NOT EXISTS permissoes text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'colaboradores' AND column_name = 'perfil'
  ) THEN
    EXECUTE $sql$
      UPDATE colaboradores
      SET cargo = CASE perfil
        WHEN 'vendedora' THEN 'vendedora'::cargo_colaborador
        WHEN 'sdr' THEN 'sdr'::cargo_colaborador
        WHEN 'financeiro' THEN 'financeiro'::cargo_colaborador
        WHEN 'gestao' THEN 'administrativo'::cargo_colaborador
        WHEN 'admin' THEN 'administrativo'::cargo_colaborador
        ELSE cargo
      END
      WHERE cargo IS NULL
    $sql$;
    EXECUTE 'ALTER TABLE colaboradores ALTER COLUMN perfil DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE colaboradores
  ALTER COLUMN cargo SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS colaboradores_auth_user_unique
  ON colaboradores(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- O schema real já usa estes campos no agendamento operacional. A inclusão é
-- aditiva para bases que ainda não receberam a evolução de SDR/comparecimento.
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS sdr_id uuid REFERENCES colaboradores(id) ON DELETE SET NULL;
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS comparecimento_status text NOT NULL DEFAULT 'pendente';
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS comparecimento_em timestamptz;
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS comparecimento_registrado_por uuid REFERENCES colaboradores(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS comissao_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cargo cargo_colaborador,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('valor_fixo','percentual','faixa')),
  valor numeric(14,4) NOT NULL CHECK (valor >= 0),
  meta_base numeric(14,2),
  configuracao jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE comissao_regras
  ADD COLUMN IF NOT EXISTS cargo cargo_colaborador;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comissao_regras' AND column_name = 'perfil'
  ) THEN
    EXECUTE $sql$
      UPDATE comissao_regras
      SET cargo = CASE perfil
        WHEN 'vendedora' THEN 'vendedora'::cargo_colaborador
        WHEN 'sdr' THEN 'sdr'::cargo_colaborador
        WHEN 'financeiro' THEN 'financeiro'::cargo_colaborador
        WHEN 'gestao' THEN 'administrativo'::cargo_colaborador
        WHEN 'admin' THEN 'administrativo'::cargo_colaborador
        ELSE cargo
      END
      WHERE cargo IS NULL
    $sql$;
    EXECUTE 'ALTER TABLE comissao_regras ALTER COLUMN perfil DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE comissao_regras
  ALTER COLUMN cargo SET NOT NULL;

CREATE INDEX IF NOT EXISTS comissao_regras_cargo_ativo_idx
  ON comissao_regras(cargo, ativo, vigencia_inicio DESC);

INSERT INTO comissao_regras (cargo, nome, tipo, valor, meta_base)
SELECT 'vendedora'::cargo_colaborador, 'Primeira parcela paga', 'valor_fixo', 100.00, NULL
WHERE NOT EXISTS (SELECT 1 FROM comissao_regras WHERE cargo = 'vendedora' AND ativo = true);

INSERT INTO comissao_regras (cargo, nome, tipo, valor, meta_base)
SELECT 'sdr'::cargo_colaborador, 'Comparecimento em agendamento', 'valor_fixo', 10.00, NULL
WHERE NOT EXISTS (SELECT 1 FROM comissao_regras WHERE cargo = 'sdr' AND ativo = true);

INSERT INTO comissao_regras (cargo, nome, tipo, valor, meta_base)
SELECT 'financeiro'::cargo_colaborador, 'Recuperação de carteira em atraso', 'percentual', 1.69, 90000.00
WHERE NOT EXISTS (SELECT 1 FROM comissao_regras WHERE cargo = 'financeiro' AND ativo = true);

CREATE TABLE IF NOT EXISTS comissao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  regra_id uuid REFERENCES comissao_regras(id) ON DELETE SET NULL,
  referencia_tipo text,
  referencia_id text,
  base_calculo numeric(14,2),
  valor_comissao numeric(14,2) NOT NULL CHECK (valor_comissao >= 0),
  status text NOT NULL DEFAULT 'prevista' CHECK (status IN ('prevista','validada','paga','cancelada')),
  competencia date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comissao_eventos_colaborador_idx
  ON comissao_eventos(colaborador_id, competencia DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS comissao_evento_referencia_unique
  ON comissao_eventos(colaborador_id, regra_id, referencia_tipo, referencia_id)
  WHERE referencia_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS treinamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  descricao text,
  tipo text NOT NULL CHECK (tipo IN ('video','imagem','texto','misto')),
  conteudo_url text,
  conteudo_texto text,
  cargos cargo_colaborador[] NOT NULL DEFAULT ARRAY[]::cargo_colaborador[],
  obrigatorio boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE treinamentos
  ADD COLUMN IF NOT EXISTS cargos cargo_colaborador[] NOT NULL DEFAULT ARRAY[]::cargo_colaborador[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'treinamentos' AND column_name = 'perfis'
  ) THEN
    EXECUTE $sql$
      UPDATE treinamentos t
      SET cargos = ARRAY(
        SELECT DISTINCT CASE p
          WHEN 'vendedora' THEN 'vendedora'::cargo_colaborador
          WHEN 'sdr' THEN 'sdr'::cargo_colaborador
          WHEN 'financeiro' THEN 'financeiro'::cargo_colaborador
          WHEN 'gestao' THEN 'administrativo'::cargo_colaborador
          WHEN 'admin' THEN 'administrativo'::cargo_colaborador
          ELSE NULL
        END
        FROM unnest(t.perfis) p
        WHERE p <> 'todos'
      )
      WHERE cardinality(cargos) = 0
    $sql$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS treinamento_progresso (
  treinamento_id uuid NOT NULL REFERENCES treinamentos(id) ON DELETE CASCADE,
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  progresso integer NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  concluido_em timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (treinamento_id, colaborador_id)
);

-- SDR: gera comissão somente quando o comparecimento é efetivamente registrado.
CREATE OR REPLACE FUNCTION public.gerar_comissao_sdr_comparecimento_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  regra comissao_regras%rowtype;
BEGIN
  IF new.comparecimento_status IS DISTINCT FROM 'compareceu'
     OR coalesce(old.comparecimento_status, '') = 'compareceu'
     OR new.sdr_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT * INTO regra
  FROM comissao_regras
  WHERE cargo = 'sdr' AND ativo = true
    AND vigencia_inicio <= coalesce(new.comparecimento_em::date, current_date)
    AND (vigencia_fim IS NULL OR vigencia_fim >= coalesce(new.comparecimento_em::date, current_date))
  ORDER BY vigencia_inicio DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN new; END IF;

  INSERT INTO comissao_eventos (
    colaborador_id, regra_id, referencia_tipo, referencia_id,
    base_calculo, valor_comissao, status, competencia, metadata
  ) VALUES (
    new.sdr_id, regra.id, 'comparecimento_sdr', new.id::text,
    1, regra.valor, 'validada',
    date_trunc('month', coalesce(new.comparecimento_em, now()))::date,
    jsonb_build_object('agendamento_id', new.id, 'comparecimento_em', new.comparecimento_em)
  ) ON CONFLICT DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_comissao_sdr_comparecimento_agendamento ON agendamentos;
CREATE TRIGGER trg_comissao_sdr_comparecimento_agendamento
AFTER UPDATE OF comparecimento_status ON agendamentos
FOR EACH ROW EXECUTE FUNCTION public.gerar_comissao_sdr_comparecimento_agendamento();

ALTER TABLE comissao_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE comissao_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE treinamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE treinamento_progresso ENABLE ROW LEVEL SECURITY;
