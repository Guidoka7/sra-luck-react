# Preview Vercel — diagnóstico de autenticação

O preview utiliza SPA Vite e Vercel Functions. O fallback para `index.html` nunca deve interceptar `/api/*`.

Sintomas e interpretação:
- `405` em POST de login: rota de API caiu no arquivo estático/fallback da SPA.
- `503` do backend: Function foi alcançada, mas falta configuração privada no ambiente.
- `401`: credenciais/sessão não foram aceitas.

A correção de roteamento fica em `vercel.json`; a Function de compatibilidade fica em `api/[...path].ts`.
