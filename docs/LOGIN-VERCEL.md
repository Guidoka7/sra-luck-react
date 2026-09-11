# Login no preview da Vercel

O frontend Vite usa as mesmas rotas `/api/*` do Worker. No preview da Vercel, `api/[...path].ts` adapta essas requisições para o mesmo backend, e `vercel.json` deve preservar `/api/*` antes do fallback da SPA.

Variáveis públicas do frontend:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Variáveis privadas necessárias para autenticação real no preview da Vercel:
- `SUPABASE_URL` (ou o alias público de URL já suportado pelo adapter)
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENTE_SESSION_SECRET`

As variáveis privadas nunca devem usar prefixo `VITE_` e nunca devem ser copiadas para o código-fonte.

Um `405` em `POST /api/cliente/auth` ou `POST /api/admin/auth` indica que a requisição caiu no fallback estático em vez da Function. Um `503` com mensagem de serviço indisponível indica que a Function foi alcançada, mas alguma configuração privada obrigatória não está disponível naquele ambiente.
