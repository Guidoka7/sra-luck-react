# Publicação manual no Netlify

1. No Netlify, crie um novo site a partir do repositório/projeto.
2. Use Node.js 20.
3. Build command:
   `npm run build`
4. Não defina um publish directory manualmente para o Next.js; deixe o plugin/runtime do Next.js tratar a saída.
5. Configure as variáveis de ambiente do `.env.local` no Netlify (Production), sem colocar os valores secretos no código.

Variáveis esperadas:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- CLIENTE_SESSION_SECRET
- WEB_PUSH_VAPID_SUBJECT
- WEB_PUSH_VAPID_PUBLIC_KEY
- WEB_PUSH_VAPID_PRIVATE_KEY
- NOTIFICACOES_APP_URL (use a URL HTTPS final do Netlify quando aplicável)

Importante:
- Não faça upload do `.env.local` para um repositório público.
- Service Role, segredo de sessão e VAPID private key ficam somente nas variáveis do Netlify.
- Depois do primeiro deploy, abra a URL HTTPS no celular e teste instalação e notificações.
- O Push requer contexto seguro (HTTPS; localhost também é permitido para desenvolvimento).
