-- Foto de perfil da cliente: caminho privado + bucket dedicado.
alter table public.clientes
  add column if not exists foto_perfil_path text;

comment on column public.clientes.foto_perfil_path is
  'Caminho privado da foto de perfil da cliente no Supabase Storage. Acesso somente pelo Worker autenticado.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clientes-perfil',
  'clientes-perfil',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
