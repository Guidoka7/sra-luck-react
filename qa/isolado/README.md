# QA isolado local (banco, Auth e Storage fora da produção)

Ambiente usado em 28/09/2026 para executar as jornadas completas e o teste de RBAC/M2M
**sem tocar o Supabase de produção** (`sbohknqapprimtspczio`). Tudo roda em `127.0.0.1`.

Por que local: o Supabase Branching exige plano Pro (US$ 25/mês + cobrança por hora do
branch) e a organização está no Free com 2 projetos ativos. Um Preview hospedado isolado
depende dessa decisão de custo.

## Peças

| Pasta | Conteúdo |
|---|---|
| `schema/` | Estrutura exportada do catálogo de produção (somente leitura, **sem dados**): tipos, 70 tabelas, 281 constraints, 113 funções, view, 260 índices, 28 triggers, RLS/policy, grants e os 3 buckets. `functions_manifest.prod.txt` tem o md5 de cada função de produção para provar paridade. |
| `seed/` | Dados 100% fictícios (CPFs com prefixo 900, e-mails `@sraluck.test`), criados pelas **mesmas RPCs de produção**. |
| `tools/` | `qa-serve.mjs` (app; recusa iniciar se `SUPABASE_URL` não for local), `console-serve.cjs` (Dev Console com os rewrites do `vercel.json`), `run-app.sh`, `run-console.sh`, extratores. |
| `jornadas/` | Roteiros Playwright/HTTP de cada fluxo (J01–J18). J16: levantamento atômico. J17: importação do RD com respostas simuladas (TypeScript; empacotar com esbuild dentro do repo e rodar com `SUPABASE_URL` local, recusa URL remota). J18: fila de pendências no Console (RBAC) e vínculo/revisão no Admin. |
| `supabase/config.toml` | Stack local (Realtime/Studio/Edge desligados). |

Credenciais de QA ficam em `$QA_PRIVADO/qa-credentials.env` (padrão `/tmp/sra-luck-qa`),
fora do repositório, geradas com `openssl rand`.

## Subir

1. `npx supabase start` com este `config.toml` (`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` se o ECR estiver bloqueado) e um segundo stack com portas 553xx para o banco do Dev Console.
2. `psql <db local> -f schema/load.psql` e conferir `functions_manifest` (113/113 idênticas).
3. Criar os usuários pelo Auth admin local, rodar `seed/01_seed_qa.sql` (e 02/03 conforme o cenário).
4. `npm run build` com `VITE_SUPABASE_URL=http://127.0.0.1:54321` e a anon key local; `tools/run-app.sh`; `tools/run-console.sh`.
5. `node jornadas/jXX-*.mjs`.

O ambiente é descartável: `npx supabase stop --no-backup` apaga tudo.
