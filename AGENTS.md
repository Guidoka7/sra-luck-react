# AGENTS.md — Guia para IA e automações

Este repositório está em migração de **Next.js** para **React + Vite + Cloudflare Workers**.

## Regra principal

- O projeto base funcional atual é `sra-luck-pwa`.
- Este repositório (`sra-luck-react`) é o destino da migração e será o projeto oficial quando a migração terminar.
- Não remova código legado só porque ele é Next.js. Antes, confirme que o equivalente React/Worker existe e cobre o mesmo fluxo.

## Arquitetura de destino

```text
Browser
  -> React + Vite
  -> /api/*
  -> Cloudflare Worker
  -> Supabase
```

Entradas principais:

- Frontend: `src/main.tsx`
- Backend: `worker/index.ts`
- Cloudflare: `wrangler.jsonc`
- Vite: `vite.config.ts`
- Banco: `supabase/`

## Onde editar

### Design, telas e UX

Procure primeiro em:

- `src/pages/`
- `src/components/`
- `src/styles/`

Não edite `src/app/` para criar novas telas React. `src/app/` contém principalmente superfície herdada do Next durante a migração.

### Funcionalidades de frontend

Procure em:

- `src/pages/`
- `src/components/`
- `src/lib/`
- `src/types/`

Sempre confirme quais APIs `/api/*` a tela consome antes de alterar fluxos.

### Backend / APIs

Procure em:

- `worker/index.ts`
- módulos `worker/*.ts`

Novas operações privilegiadas devem ficar no Worker, nunca no navegador.

### Banco e regras de concorrência

Procure em:

- `supabase/`

Mudanças de agenda, vagas, cirurgia, parcelas, pagamentos ou financeiro podem depender de RPCs, constraints, migrations ou RLS. Não replique regras críticas apenas no frontend.

## Segurança obrigatória

- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` em `VITE_*`.
- Nunca coloque segredos diretamente no código.
- Secrets do Worker devem ser configurados via Cloudflare/Wrangler.
- Cookies de sessão e autenticação devem continuar `HttpOnly` e protegidos.
- Rotas mutáveis devem preservar proteção contra origem externa/CSRF equivalente.
- Antes de alterar autenticação, leia `worker/session.ts` e o fluxo de login correspondente.

## Regras para migração

Ao migrar uma funcionalidade do PWA para React:

1. Identifique o fluxo completo no `sra-luck-pwa`.
2. Liste tela, chamadas de API, regras de negócio, banco, uploads e notificações envolvidos.
3. Implemente a UI em React.
4. Implemente ou valide o endpoint equivalente no Worker.
5. Confirme RPCs/migrations/RLS no Supabase.
6. Valide estados de erro e loading.
7. Rode `npm run lint`.
8. Rode `npm run build`.
9. Só marque o legado como removível após equivalência funcional confirmada.

## Convenções para código novo

- Prefira arquivos pequenos e com responsabilidade única.
- Evite adicionar mais responsabilidades a `worker/index.ts` quando puder criar um módulo específico.
- Dê nomes de domínio claros: `agenda`, `clientes`, `financeiro`, `boletos`, `notificacoes`, `relatorios`.
- Evite abstrações genéricas sem necessidade.
- Tipos compartilhados devem ter nomes de negócio, não nomes vagos como `Data` ou `Item`.
- Comentários devem explicar decisões ou riscos, não repetir o código.

## Antes de qualquer edição grande

Leia:

1. `AGENTS.md`
2. `docs/AI-CODEMAP.md`
3. `docs/MIGRATION-MAP.md`
4. `docs/ARCHITECTURE.md`

## Checklist final da IA

Antes de concluir uma alteração:

- O código mexeu apenas nas camadas necessárias?
- Algum segredo foi exposto ao frontend?
- Alguma regra do PWA deixou de ser portada?
- Alguma RPC/constraint do Supabase foi ignorada?
- `npm run lint` passa?
- `npm run build` passa?
- A documentação de migração precisa ser atualizada?
