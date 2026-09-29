-- migration_119 — imagens das recompensas do Clube guardadas no próprio app.
--
-- Em 25/09/2026 a imagem da recompensa "Nécessaire premium" foi cadastrada como miniatura
-- temporária do Dropbox (previews.dropbox.com): o link expirou e a imagem passou a falhar no app
-- (RESOURCE_LOAD_ERROR em /agenda). O link de compartilhamento original também não é público.
-- Agora o Admin envia a imagem, que fica no bucket privado clube-recompensas e é servida por
-- /api/clube/recompensas/{id}/imagem (endereço permanente, com cache).
--
-- Não destrutiva. Rollback: supabase/rollback/migration_119_rollback.sql.

alter table public.clube_recompensas add column if not exists imagem_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clube-recompensas', 'clube-recompensas', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
