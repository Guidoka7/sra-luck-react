# Sra. Luck — PWA cliente / Netlify

Esta versão está preparada para publicação no Netlify.

## Publicação
- Build: `npm run build`
- Framework: Next.js 14
- PWA: `/simulador-iphone.webmanifest`
- Service Worker: `/simulador-iphone-sw.js`
- Entrada de instalação: `/simulador-iphone.html`
- App instalado: `/agenda`

## Variáveis necessárias no Netlify
Configure no ambiente de produção os mesmos valores usados no `.env.local`, sem publicar segredos no código:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENTE_SESSION_SECRET`
- `WEB_PUSH_VAPID_SUBJECT`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`

`NOTIFICACOES_APP_URL` deve apontar para a URL HTTPS final do deployment se o worker de notificações for utilizado.

Não exponha `SUPABASE_SERVICE_ROLE_KEY`, `CLIENTE_SESSION_SECRET` ou `WEB_PUSH_VAPID_PRIVATE_KEY` no frontend.

## Observação
O Push só pode ser testado em contexto seguro (HTTPS ou localhost). No Netlify o site deve usar HTTPS.
