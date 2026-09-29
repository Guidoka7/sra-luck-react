-- Rollback da migration_119 (só depois de remover os arquivos do bucket pelo painel do Storage).
alter table public.clube_recompensas drop column if exists imagem_path;
delete from storage.buckets where id = 'clube-recompensas';
