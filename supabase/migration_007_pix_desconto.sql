-- ============================================================================
-- migration_007_pix_desconto.sql
--
-- Adiciona à tabela `configuracoes` (singleton) o percentual de desconto
-- oferecido à cliente quando ela paga uma parcela em atraso via PIX.
--
-- Importante: o desconto incide APENAS sobre os acréscimos de juros e multa
-- gerados pelo atraso — nunca sobre o valor original da parcela. É um
-- incentivo para a cliente regularizar via PIX em vez de manter o débito.
-- Editável pelo admin em /admin/configuracoes, dentre valores predefinidos
-- (0%, 5%, 10%, 15%, 20%, 25%, 30%).
-- ============================================================================

alter table configuracoes
  add column if not exists pix_desconto_percentual numeric(5,2) not null default 0;

comment on column configuracoes.pix_desconto_percentual is
  'Percentual de desconto aplicado sobre juros + multa quando a cliente paga uma parcela vencida via PIX. Nunca incide sobre o valor original da parcela.';
