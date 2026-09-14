-- ============================================================================
-- migration_042_cargo_gestao.sql
--
-- Fase 8 (RBAC): adiciona o papel "Gestão" (docs/BUSINESS-RULES.md §16 já
-- documentava Vendedora/SDR/Financeiro/Gestão/Admin como papéis previstos —
-- só faltava o valor "gestao" no enum). Aditivo: apenas amplia o enum, não
-- remove nem renomeia nenhum valor existente.
-- ============================================================================

alter type cargo_colaborador add value if not exists 'gestao';
