-- migration_121 — logs_alteracoes.entidade_id aceita identificadores que não são UUID.
--
-- entidade_id era uuid, mas 16 pontos do App gravam o identificador da integração
-- ("rd_station", "web_push", "gemini", "conta_azul"): o banco recusava o insert e o erro era
-- ignorado. Resultado: nenhum teste de conexão ficava registrado ("conexão nunca verificada"
-- no Dev Console mesmo após testar), nem importações do RD, OAuth, catálogo e chaves VAPID.
-- Texto aceita os dois; UUIDs gravados pelas funções do banco continuam iguais (conversão
-- automática na gravação). Nenhuma view, política ou função compara esta coluna.
--
-- Não destrutiva. Rollback: supabase/rollback/migration_121_rollback.sql.

alter table public.logs_alteracoes alter column entidade_id type text using entidade_id::text;
