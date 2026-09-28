-- Buckets de Storage espelhados da produção (somente configuração, sem objetos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('boletos-clientes', 'boletos-clientes', false, 20971520, array['application/pdf','image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('clientes-perfil', 'clientes-perfil', false, 5242880, array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('clube-vouchers', 'clube-vouchers', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
