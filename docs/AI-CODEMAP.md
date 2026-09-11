# AI Codemap — Sra. Luck React

Objetivo: permitir que uma IA localize rapidamente onde investigar antes de alterar uma função.

Este mapa descreve o estado atual e a direção de organização. Ele deve ser atualizado conforme o runtime for sendo reorganizado.

## 1. Entradas principais

### Frontend

- `src/main.tsx` — entrada da SPA React e roteamento atual.
- `src/pages/` — páginas React do runtime migrado.
- `src/features/` — features novas/extraídas.
- `src/components/` — componentes compartilhados e componentes herdados/migrados.
- `src/styles/` e `src/app/globals.css` — estilos globais/legados ainda utilizados.
- `src/lib/` — clientes, utilitários e integrações compartilhadas.
- `src/types/` — tipos compartilhados.
- `src/shims/` — compatibilidade temporária com imports Next.

### Backend

- `worker/index.ts` — entrada e roteamento do Cloudflare Worker.
- `worker/admin-*.ts` — handlers administrativos atuais.
- `worker/client-*.ts` — handlers da cliente atuais.
- `worker/admin-finance.ts` — fluxos financeiros administrativos.
- `worker/admin-parcelas.ts` — gestão de parcelas.
- `worker/client-boletos.ts` — boletos/comprovantes da cliente.
- `worker/client-agenda.ts` — agenda da cliente; deve ser auditado contra a regra nova antes de evoluções.
- `worker/journey.ts` — jornada nova; evitar duplicação de regra com handlers antigos.
- `worker/integrations-core.ts` e providers relacionados — integrações/adapters.
- `worker/staff-*.ts` — domínio de colaboradores quando presente.

### Banco

- `supabase/` — migrations, schema, seed e scripts relacionados.
- Antes de alterar regra financeira/agenda, pesquisar RPCs, triggers, constraints e RLS relacionados.

### Preview/deploy

- `vite.config.ts` — frontend/Cloudflare Vite.
- `wrangler.jsonc` — Worker/SPA.
- `vercel.json` — Preview do frontend/Vercel.
- `api/` — adapters temporários para Preview Vercel; não confundir com backend definitivo.

## 2. Baseline histórica

Para função que existia antes da migração, consultar também:

`Guidoka7/sra-luck-pwa/main`

Áreas mais importantes:

- `src/app/agenda/page.tsx` — experiência principal da cliente;
- `src/components/cliente/TabBoletos.tsx` — experiência de boletos;
- `src/components/cliente/CalendarioAgendamento.tsx` — calendário dos termos;
- `src/components/cliente/CalendarioCirurgia.tsx` — calendário histórico de cirurgia;
- `src/app/admin/(painel)/agenda/` — agenda administrativa;
- `src/app/admin/(painel)/clientes/` — clientes;
- `src/app/admin/(painel)/pagamentos/` — pagamentos/comprovantes;
- `src/app/admin/(painel)/parcelas/` — gestão de carnê;
- `src/app/admin/(painel)/configuracoes/` — configurações;
- `src/app/admin/(painel)/notificacoes/` — central de notificações;
- `src/app/api/` — rotas históricas;
- `supabase/` — migrations/regras históricas.

## 3. Onde procurar por domínio

### Login cliente

Primeiro procurar:

- `src/pages/LoginPage.tsx`;
- `src/features/auth/`;
- `worker/index.ts`;
- handler de autenticação/sessão da cliente;
- `src/lib/session*`/equivalentes;
- baseline PWA: `src/app/login/page.tsx` e `/api/cliente/auth`.

Não alterar formato de data/sessão sem verificar compatibilidade com `clientes.data_nascimento` e cookie de sessão.

### Login/admin/autorização

Procurar:

- `src/pages/AdminLoginPage.tsx`;
- `src/features/auth/`;
- `worker/admin-auth.ts`;
- guard/sessão administrativa;
- permissões/RLS.

### Área da cliente

Procurar:

- `src/pages/AgendaPage.tsx`;
- `src/features/client/`;
- componentes de cliente herdados;
- `worker/client-agenda.ts`;
- `worker/client-boletos.ts`;
- `worker/journey.ts`.

Antes de redesenhar, comparar com `docs/PWA-FUNCTIONAL-BASELINE.md`.

### Boletos e parcelas

Procurar:

- componentes de boletos da cliente;
- `worker/client-boletos.ts`;
- `worker/admin-parcelas.ts`;
- APIs administrativas de pagamentos;
- tabelas `boletos`/parcelas e logs;
- migrations de gestão/numeração/suspensão no PWA e React.

Regra crítica: percentual operacional usa quantidade de parcelas pagas.

### Clientes e contratos

Procurar:

- páginas/componentes administrativos de Clientes;
- `worker/admin-api.ts`/handlers de clientes;
- tipos em `src/types/`;
- tabela `clientes` e futuras entidades de contrato/política.

Não mudar significado de `valor_contrato` sem migration e compatibilidade explícita.

### Taxa administrativa

Procurar:

- `taxa_administrativa_percentual`;
- `custo_total`;
- geração/recalculo de parcelas;
- relatórios de receita.

Manter separado valor base/crédito de receita administrativa.

### Financeiro

Procurar:

- `src/features/financeiro/` e a rota `/admin/financeiro`;
- `worker/admin-financeiro.ts` — resumo, recebíveis, validações e baixa manual;
- `worker/admin-finance.ts`;
- `worker/admin-parcelas.ts`;
- `worker/client-boletos.ts`;
- `financeiro_recebimentos` e `boletos`;
- providers bancários;
- Conta Azul/Mercado Pago.

Toda baixa precisa de identidade da parcela, origem, idempotência e auditoria.
As rotas antigas `/admin/pagamentos` e `/admin/parcelas` são apenas redirects para abas do Financeiro Unificado.

### Agenda e termos

Procurar:

- página de agenda admin;
- calendário cliente;
- `worker/client-agenda.ts`;
- `worker/agendamento-acoes.ts`;
- RPCs/constraints de vagas;
- `worker/journey.ts`.

Não reintroduzir regra antiga de 90 dias. Usar a regra atual de `BUSINESS-RULES.md`.

### Jornada/liberação

Procurar:

- `worker/journey.ts`;
- componentes de progresso/solicitação;
- revisão financeira admin;
- solicitações de liberação;
- agenda de termos;
- quitação;
- liberação da cirurgia.

Uma única regra deve definir a transição de cada etapa.

### Notificações

Procurar:

- páginas/componentes administrativos de notificações;
- `worker/admin-notificacoes.ts`;
- código de push;
- templates/configurações;
- logs;
- baseline PWA de automação.

### Configurações/design

Procurar:

- `src/features/admin/AdminSettingsPanel.tsx`;
- `src/features/admin/adminAppearance.ts`;
- ThemeProvider/ThemeToggle;
- tokens CSS;
- API/configurações no Worker;
- tabela `configuracoes`.

Não remover light/dark ou opções existentes durante refino.

### Integrações

Procurar:

- `worker/integrations-core.ts`;
- providers/adapters;
- webhooks;
- factory/configuração;
- env bindings.

UI nunca deve conhecer detalhes de autenticação do provedor.

### Colaboradores

Procurar:

- `src/features/staff/`;
- handlers `worker/staff-*`;
- tabelas de staff, comissão, treinamento;
- permissões.

### Clube de Vantagens

Procurar:

- `credit-ops` apenas se realmente for o domínio ativo correspondente;
- tabelas de pontos/recompensas/referrals;
- APIs da cliente e admin.

Não assumir equivalência pelo nome; confirmar comportamento.

## 4. Estrutura alvo por domínio

A evolução deve caminhar incrementalmente para algo equivalente a:

```text
src/
  app/                 # composição/roteamento da SPA
  features/
    auth/
    client/
    contracts/
    installments/
    finance/
    scheduling/
    journey/
    notifications/
    staff/
    rewards/
    integrations-admin/
  components/
    ui/                # design system compartilhado
  services/            # HTTP/clientes transversais
  config/              # config pública/tokens
  lib/                 # utilidades técnicas
  types/

worker/
  index.ts              # composição/roteamento
  routes/
    client/
    admin/
    webhooks/
  domain/
    contracts/
    installments/
    finance/
    scheduling/
    journey/
    commissions/
    rewards/
  providers/
    rd-station/
    conta-azul/
    mercado-pago/
    banks/
  auth/
  validation/
  observability/
  shared/

supabase/
  migrations/
  seed/
  docs/
```

Isso é direção, não autorização para mover tudo de uma vez. Refactors estruturais devem ser incrementais e cobertos por testes.

## 5. Regra para IA localizar mudança

Ao receber um pedido como “mudar X”, seguir:

1. pesquisar o termo/feature no React;
2. localizar a rota/handler correspondente no Worker;
3. pesquisar coluna/RPC/migration relacionada;
4. consultar PWA se X existia lá;
5. consultar `BUSINESS-RULES.md`;
6. só então editar.

Se houver duas implementações concorrentes, primeiro determinar qual está realmente no runtime ativo.

## 6. Sinais de dívida que exigem cautela

- `src/app/` com legado Next;
- `next.config.js` e arquivos de Netlify ainda no repositório;
- `src/shims/`;
- `api/` usado para Preview Vercel;
- handlers grandes diretamente em `worker/`;
- regras duplicadas entre `client-agenda.ts` e `journey.ts`;
- migrations históricas com numeração duplicada;
- componentes grandes com fetch + regra + UI no mesmo arquivo.

Não corrigir todos simultaneamente. Marcar e reduzir dívida conforme o domínio for migrado.

## 7. Ao terminar uma mudança

Atualizar este mapa se:

- um domínio mudou de pasta;
- uma rota foi substituída;
- uma regra mudou de autoridade;
- um bloco legado foi removido;
- um provider novo foi adicionado.

Um codemap desatualizado é pior do que um codemap curto.
