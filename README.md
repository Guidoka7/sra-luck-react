# Sra. Luck — Ecossistema Operacional

Aplicação React + Vite com backend em Cloudflare Workers e dados no Supabase para operação de contratos, pagamentos, agenda, aplicativo da cliente, PWA da equipe, comissões, treinamentos e Clube de Vantagens.

## Arquitetura

```text
Cliente / Equipe / Admin (React + Vite)
              |
              | HTTPS + sessão HttpOnly
              v
Cloudflare Worker
  | autorização HMAC / Supabase Auth
  | rate limit IP + usuário
  | validação de entrada
  | auditoria + métricas
  |
  +-----------------------> Supabase PostgreSQL / Storage
  |                           ^
  |                           | service_role somente no Worker
  |                           |
  +--> ProviderFactory -------+
       | BancoProvider
       | RDProvider
       | PagamentoProvider
       v
BRB / BB / Santander / Sicredi / Efí
RD Station / Mercado Pago / Conta Azul
```

O navegador não recebe `SUPABASE_SERVICE_ROLE_KEY`, tokens de bancos nem segredos de webhooks. As tabelas sensíveis ficam com RLS `deny-by-default`; o Worker é o ponto de entrada para operações privilegiadas.

## Requisitos

- Node.js 22+
- npm 10+
- projeto Supabase
- conta Cloudflare para Worker
- Netlify apenas se o frontend for publicado por build hook
- `psql` somente para o script opcional de setup local do banco

## Setup local

```bash
npm run setup:local
npm run dev
```

`setup:local` executa `npm ci`, cria `.env.local` a partir de `.env.local.example` quando necessário e, se `SUPABASE_DB_URL` ou `SUPABASE_POOLER_URL` estiver definida no ambiente do terminal, aplica `supabase/migrations.sql` e `supabase/seed.sql` com `ON_ERROR_STOP=1`.

Execução manual equivalente:

```bash
npm ci
cp .env.local.example .env.local
npm run dev
```

No Windows, copie o arquivo de exemplo pelo Explorer ou PowerShell caso não use `npm run setup:local`.

## Banco de dados

Para o banco já existente, execute as migrations legadas na ordem em que estão no diretório `supabase/` até a migration 022 e depois execute:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

O arquivo final é idempotente e registra as seções `001_20260911` a `004_20260911` em `schema_migrations`. Ele adiciona auditoria, métricas, rate limit distribuído, fila de webhooks, soft delete, índices de escala, comentários de schema e RLS restritivo.

O rollback operacional está documentado e automatizado em `supabase/rollback.sql`. Ele preserva dados de negócio e também preserva `audit_log` deliberadamente.

## Qualidade

```bash
npm run lint
npm run test
npm run build
# ou tudo de uma vez
npm run check
```

`npm run lint` executa TypeScript do frontend, TypeScript do Worker e o quality gate do runtime crítico. O gate bloqueia `console.log`, `console.error`, comentários de pendência, `any` explícito e padrões suspeitos de credencial nos módulos de produção endurecidos.

Os testes usam apenas providers mock ou `fetch` injetado. Nenhuma credencial real é necessária.

## Providers

A fábrica está em `worker/providers/factory.ts`. Em desenvolvimento, mantenha:

```text
INTEGRATION_MODE=mock
```

Na homologação/produção, depois de cadastrar os secrets e parâmetros do provider:

```text
INTEGRATION_MODE=live
```

Os adapters bancários são dirigidos por configuração de ambiente: URL base, modo de autenticação, endpoint de token, paths de cobrança e nomes de campos podem ser ajustados sem alteração de código. Detalhes estão em [INTEGRACOES.md](./INTEGRACOES.md).

## Webhooks

Endpoints oficiais:

```text
POST /api/webhooks/rd_station
POST /api/webhooks/mercado_pago
POST /api/webhooks/conta_azul
POST /api/webhooks/brb
POST /api/webhooks/bb
POST /api/webhooks/santander
POST /api/webhooks/sicredi
POST /api/webhooks/efi
```

O endpoint autentica o webhook, persiste o evento idempotentemente em `webhook_queue` e retorna `202`. Um cron do Worker roda a cada minuto e processa a fila com bloqueio, retries e backoff. Eventos de pagamento liquidados atualizam a parcela e geram registro de conciliação.

## Sessões e segurança

- Cliente: CPF validado por dígitos verificadores + data de nascimento; sessão HMAC HttpOnly.
- Admin: Supabase Auth + sessão HMAC HttpOnly de 8 horas.
- Equipe: Supabase Auth vinculado a `colaboradores` + sessão HttpOnly de 12 horas.
- Mutações sensíveis exigem mesma origem.
- Rate limit por IP é aplicado a toda API; rotas autenticadas recebem também limite por usuário.
- Valores financeiros são limitados a R$ 50 milhões por operação de domínio.
- Datas de agendamento não aceitam passado.
- Ações críticas são registradas em `audit_log`.
- Métricas básicas são gravadas em `api_request_metrics`.
- Logs do Worker são JSON estruturado e redigem nomes de campos sensíveis.

## Variáveis de ambiente

Use `.env.local.example` como contrato completo. As três variáveis públicas permitidas no frontend são:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_REVIEW_URL=
```

Segredos ficam no Worker/CI, sem prefixo `VITE_`. Entre eles estão `SUPABASE_SERVICE_ROLE_KEY`, `CLIENTE_SESSION_SECRET`, credenciais de RD Station, Mercado Pago, Conta Azul e bancos. Nunca grave valores reais no Git.

## CI/CD

`.github/workflows/production.yml` executa:

1. `npm ci`
2. `npm run lint`
3. `npm run test`
4. `npm run build`
5. em `main`, build hook do Netlify se `NETLIFY_BUILD_HOOK_URL` existir
6. em `main`, deploy do Worker se `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` existirem

Secrets ausentes fazem somente a etapa de deploy correspondente ser ignorada; nunca tornam lint/test/build opcionais.

## Estrutura relevante

```text
src/
  features/client/       app real da cliente
  features/staff/        PWA da equipe
  features/credit-ops/   painel administrativo
worker/
  middleware/            auth, rate limit, retry, logger
  providers/             interfaces, factory, adapters e mocks
  routes/                pagamentos, clientes e agenda
  validation.ts          validação compartilhada do Worker
  observability.ts       auditoria e métricas
supabase/
  migrations.sql         hardening final idempotente
  seed.sql               dados iniciais idempotentes
  rollback.sql           reversão segura do hardening
tests/
  providers/             sucesso, erro, validação e timeout
  integration/           fluxo sem credenciais reais
```

## Backup, rollback e desastre

O procedimento de backup, restauração e rollback de deploy está em `docs/ROLLBACK-DR.md`. Antes de mudanças de schema em produção, gere backup do PostgreSQL e valide a restauração. Deploy de frontend/Worker pode ser revertido para o commit anterior sem rollback de dados quando a migration for aditiva.

## Operação

O app da cliente usa o fluxo real de contrato, pagamento, solicitação de termos, escolha de quitação, assinatura, quitação final e liberação da agenda cirúrgica. O PWA da equipe mantém perfis de vendedora, SDR, financeiro, gestão e admin, com comissões e treinamentos. Regras de comissão e recompensas ficam em banco e podem ser alteradas pela administração sem alterar código.
