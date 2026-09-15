-- ============================================================================
-- migration_040_importacao_boletos_status_revisar.sql
--
-- Correção do matching de carnê (Fase 3, revisado): página importada sem
-- evidência suficiente (vencimento/valor/parcela extraídos do PDF) não pode
-- ficar como "pendente" genérico — precisa de um estado explícito que force
-- revisão humana antes de qualquer vínculo. Aditivo: amplia a constraint
-- existente, não remove nenhum valor já aceito.
-- ============================================================================

alter table importacoes_boletos drop constraint if exists importacoes_boletos_status_vinculacao_chk;

alter table importacoes_boletos add constraint importacoes_boletos_status_vinculacao_chk
  check (status_vinculacao in ('pendente', 'analisado', 'aguardando_confirmacao', 'vinculado', 'ignorado', 'revisar'));
