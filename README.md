# Sra. Luck — Cirurgia Programada

Sistema de agendamento para a Sra. Luck: a cliente entra com **CPF + data de nascimento** e escolhe, dentre as datas liberadas pela clínica, o dia da sua cirurgia — sem links, sem senha para lembrar. O admin cadastra as clientes, libera as datas com as vagas de cada dia e acompanha o orçamento do mês.

## Arquitetura atual em migração

O projeto está sendo migrado de **Next.js** para:

- **React + Vite** — frontend SPA;
- **Cloudflare Workers** — APIs/backend e lógica protegida;
- **Supabase** — PostgreSQL, Storage, Realtime e serviços de dados;
- **GitHub** — versionamento e CI.

A configuração segue o modelo oficial de React + Vite com Cloudflare Workers, usando `@cloudflare/vite-plugin` e `wrangler`. O frontend é servido como SPA e as rotas `/api/*` estão sendo migradas gradualmente para o Worker.

## Guia rápido para edição por IA

Antes de alterar fluxos, design ou funcionalidades, leia nesta ordem:

1. `AGENTS.md` — regras para IA, segurança e migração;
2. `docs/AI-CODEMAP.md` — onde localizar cada tipo de mudança;
3. `docs/MIGRATION-MAP.md` — estado da migração por domínio;
4. `docs/ARCHITECTURE.md` — arquitetura detalhada e estado real do código.

O objetivo é permitir que uma IA encontre rapidamente a camada correta sem confundir código React/Worker ativo com o legado Next ainda mantido como referência.

### Comandos principais

```bash
npm install
npm run dev
npm run build
npm run preview
npm run deploy
```

### Variáveis de ambiente

O frontend usa apenas variáveis públicas com prefixo `VITE_`:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_REVIEW_URL=
```

Segredos como `SUPABASE_SERVICE_ROLE_KEY` e `CLIENTE_SESSION_SECRET` devem ficar exclusivamente no Cloudflare Worker, configurados como secrets. **Nunca coloque a service role key em uma variável `VITE_*`.**

### Estado da migração

A fundação do novo runtime já está criada:

- `vite.config.ts` — integração Vite + Cloudflare;
- `wrangler.jsonc` — configuração do Worker e fallback SPA;
- `worker/index.ts` — entrada das APIs Cloudflare;
- `src/main.tsx` — entrada React;
- `src/lib/supabase-vite.ts` — cliente Supabase do navegador;
- `tsconfig.worker.json` — tipos do runtime Workers.

As páginas e APIs existentes do Next.js permanecem no repositório temporariamente para permitir uma migração gradual. Elas não devem ser consideradas a arquitetura final.

## Supabase

1. Crie um projeto no Supabase.
2. Execute `supabase/schema.sql` em um banco novo ou as migrations numeradas em um banco existente.
3. Para bancos existentes, mantenha as migrations `016` e `017` de segurança/concorrência.
4. Configure a URL e a chave pública no frontend e os segredos do backend no Worker.

## Segurança

- A chave `service_role` nunca deve chegar ao navegador.
- O frontend acessa o Supabase com a chave pública e usa o Worker para operações privilegiadas.
- O login por CPF + nascimento e as regras de sessão estão sendo migrados para o Worker.
- O agendamento atômico permanece protegido pelas funções SQL já adicionadas ao Supabase.

## Próximas etapas da migração

1. Validar equivalência funcional dos fluxos já migrados.
2. Migrar as rotas e telas ainda dependentes do runtime Next.
3. Consolidar uploads, boletos, notificações e Web Push no Worker.
4. Remover arquivos legados somente após equivalência funcional confirmada.
5. Consolidar deploy/preview no Cloudflare e secrets de produção.
6. Rodar CI completo antes da limpeza final do runtime antigo.

## UI

A identidade visual existente da Sra. Luck continua sendo preservada durante a migração. Os assets de marca permanecem em `public/brand`.
