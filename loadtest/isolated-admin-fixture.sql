-- Somente xqlxzdmleekbrietejoq. Identidade fictícia para o k6 percorrer a
-- autenticação/autorização reais do painel e medir o lookup em colaboradores.
INSERT INTO public.colaboradores
  (auth_user_id,nome,email,cargo,ativo,permissoes)
VALUES
  ('00000000-0000-4000-8000-000000000001','Admin Carga Fictício',
   'admin-carga@example.invalid','administrativo',true,'{}'::text[])
ON CONFLICT (auth_user_id) DO UPDATE SET ativo=true,cargo='administrativo';
