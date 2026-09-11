# Arquitetura oficial — Sra. Luck React

Este documento descreve o estado arquitetural atual e a direção de evolução do `sra-luck-react`.

A fonte funcional histórica é `Guidoka7/sra-luck-pwa/main`. A fonte de verdade das regras novas é `docs/BUSINESS-RULES.md`.

## 1. Arquitetura de produto

```text
Cliente/Admin/Colaborador
        │
        ▼
React + Vite SPA
        │
        │ HTTPS /api/*
        ▼
Cloudflare Worker
        │
        ├── autenticação/autorização
        ├── regras de domínio
        ├── providers externos
        ├── webhooks
        └── observabilidade/auditoria
        │
        ▼
Supabase
        ├── PostgreSQL
        ├── RPCs/constraints
        ├── RLS
        ├── Storage
        └── Realtime
```

Preview visual pode ser servido pela Vercel, mas o backend oficial continua sendo o Cloudflare Worker. Adapters em `api/` são infraestrutura de Preview/transição e não devem virar uma segunda arquitetura de backend.

## 2. Responsabilidades

### React + Vite

Responsável por:

- renderização;
- navegação SPA;
- design system;
- formulários e interação;
- estado de interface;
- consumo das APIs;
- experiência PWA da cliente;
- feedback de erro/sucesso;
- acessibilidade/responsividade.

Não deve possuir:

- service role;
- tokens bancários;
- segredos de webhook;
- regra financeira autoritativa que exista apenas no browser.

### Cloudflare Worker

É a fronteira oficial de backend.

Responsável por:

- autenticação/sessões;
- autorização;
- validação server-side;
- regras de negócio protegidas;
- persistência privilegiada;
- integração com bancos/CRM/financeiro;
- webhooks;
- idempotência;
- rate limiting quando necessário;
- auditoria e logs estruturados.

### Supabase

Não é apenas armazenamento. Também protege invariantes por:

- constraints;
- funções/RPCs;
- RLS;
- índices;
- transações/concorrência;
- Storage;
- Realtime.

Regra existente no banco deve ser auditada antes de duplicar/substituir no Worker.

## 3. Estado atual do frontend

Entradas/áreas relevantes:

```text
src/
  main.tsx            # entrada SPA/roteamento atual
  pages/              # páginas React do runtime ativo
  features/           # features extraídas/novas
  components/         # componentes compartilhados + migrados
  lib/                # utilidades/clientes compartilhados
  types/
  styles/
  shims/              # compatibilidade temporária
  app/                # superfície herdada do Next ainda presente
```

A pasta `src/features/` é a direção oficial para domínios do frontend. Consultar `src/features/README.md`.

## 4. Estado atual do Worker

Hoje existem handlers diretamente em `worker/`, por exemplo:

- `admin-api.ts`;
- `admin-auth.ts`;
- `admin-finance.ts`;
- `admin-notificacoes.ts`;
- `admin-panel.ts`;
- `admin-parcelas.ts`;
- `admin-reports.ts`;
- `client-agenda.ts`;
- `client-boletos.ts`;
- `journey.ts`;
- `credit-ops.ts`;
- `integrations-core.ts`;
- outros handlers auxiliares.

Isso é o estado atual, não a organização final.

A evolução deve ser incremental para:

```text
worker/
  index.ts
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
```

Consultar `worker/README.md`.

## 5. Domínios de negócio

Os domínios principais do produto são:

- autenticação e permissões;
- clientes;
- contratos/políticas;
- parcelas/cobranças;
- pagamentos/conciliação;
- financeiro;
- jornada de liberação;
- agenda de termos;
- agenda cirúrgica;
- notificações;
- integrações;
- colaboradores/comissões/treinamentos;
- forecast/planejamento;
- Clube de Vantagens/indicações.

Admin/Cliente são superfícies de produto; regra de negócio compartilhada deve viver em domínio reutilizável quando apropriado.

## 6. Contratos e configurabilidade

Políticas que podem mudar devem ser modeladas de forma configurável/versionável, não espalhadas em condicionais.

Exemplos:

- percentual mínimo;
- taxa administrativa;
- prazo de liberação;
- modalidades;
- formas de pagamento;
- comissão;
- permissões;
- agenda;
- notificações;
- identidade visual.

Um contrato existente deve preservar a política relevante da sua vigência quando uma mudança futura não puder ser retroativa.

## 7. Identidade financeira

Separar sempre:

- valor base/carta/crédito;
- taxa administrativa;
- total contratado;
- valor recebido;
- receita administrativa;
- saldo final;
- eventos de pagamento.

Percentual de elegibilidade usa quantidade de parcelas pagas, não valor financeiro.

## 8. Eventos financeiros e idempotência

Toda operação externa precisa de vínculo estável.

Conceitualmente:

```text
parcela interna
   ├── id externo do banco
   ├── id de pagamento Mercado Pago
   ├── referência Conta Azul
   ├── comprovantes
   └── eventos de liquidação/validação
```

Webhooks podem ser entregues mais de uma vez. O efeito financeiro não pode ser duplicado.

Na fase 1 do Financeiro Unificado, `financeiro_recebimentos` é o ledger de baixas e validações. As funções SQL
`financeiro_baixar_boleto` e `financeiro_validar_comprovante` bloqueiam a parcela, verificam a chave de idempotência,
registram o evento e atualizam `boletos.status` na mesma transação. O Worker expõe esse contrato somente sob
`/api/admin/financeiro`; a UI não grava diretamente nas tabelas. Mercado Pago, Conta Azul, RD Station e bancos
continuam sem conexão ativa.

## 9. Providers externos

Usar adapters/providers.

### Bancos

Contrato comum deve normalizar, conforme suporte de cada banco:

- emissão;
- consulta;
- alteração;
- cancelamento;
- arquivo/linha digitável;
- status;
- liquidação;
- webhook;
- erro.

Implementações previstas:

- BRB;
- Banco do Brasil;
- Santander;
- Sicredi;
- Efí.

### Outros providers

- RD Station CRM;
- Conta Azul;
- Mercado Pago.

A UI conhece nossa API, não o contrato específico do provedor.

## 10. Autenticação

### Cliente

- CPF + data de nascimento;
- sessão segura por cookie HttpOnly;
- Worker valida sessão nas rotas protegidas.

### Admin/colaboradores

- autenticação forte;
- papel/permissão explícitos;
- backend sempre autoriza a ação;
- esconder menu não substitui autorização.

## 11. Design system

O design é maleável, mas centralizado.

Precisamos tender a concentrar:

- cores;
- tokens semânticos;
- tipografia;
- espaçamento;
- radius;
- sombras;
- estados de controles;
- componentes base.

Light/dark mode são capacidades do produto.

Cliente: mobile-first.

Admin: desktop-first e responsivo.

## 12. PWA

A experiência PWA é prioritária para a cliente.

Capacidades a validar:

- instalação;
- service worker;
- atualizações;
- Web Push;
- permissões;
- comportamento offline somente onde fizer sentido.

Não considerar push funcional apenas pela presença de arquivos; provar envio ponta a ponta.

## 13. Preview e deploy

### Desenvolvimento/Preview

Fluxo preferido:

```text
branch
  ↓
commit/push
  ↓
CI
  ↓
Vercel Preview
  ↓
validação visual/operacional
```

Para funções que dependem de backend real, o Preview precisa alcançar o Worker/configuração correspondente.

### Produção

Frontend e Worker devem usar configuração de produção separada, com secrets próprios.

Não usar secrets de produção em Preview sem decisão explícita.

## 14. Legado Next

Ainda existem elementos herdados:

- `src/app/`;
- `src/middleware.ts`;
- `next.config.js`;
- imports/shims relacionados;
- arquivos Netlify históricos.

Eles não representam a arquitetura final.

Também não devem ser apagados em massa sem comprovar que nenhuma função ativa depende deles.

Consultar `docs/MIGRATION-MAP.md`.

## 15. Banco e migrations

O histórico de migrations herdado contém numeração repetida. Não renomear migrations antigas cegamente.

Novas migrations devem seguir sequência inequívoca e documentada.

Consultar `supabase/README.md`.

## 16. Testes

A estratégia de testes deve crescer junto com os domínios.

Prioridades:

1. regras puras de negócio;
2. autenticação/autorização;
3. parcela/pagamento/idempotência;
4. transições da jornada;
5. concorrência da agenda;
6. providers/webhooks;
7. fluxos de integração;
8. E2E dos caminhos principais.

O `package.json` atual precisa ser consultado antes de assumir scripts de teste disponíveis.

## 17. Observabilidade

Precisamos de:

- logs estruturados;
- request/event IDs;
- erro de integração com contexto não sensível;
- métricas operacionais;
- audit log de mudança crítica;
- monitoramento frontend;
- alertas para falhas relevantes.

## 18. Como evoluir sem desorganizar

Para cada domínio:

```text
mapear baseline PWA
      ↓
mapear implementação React atual
      ↓
mapear Worker
      ↓
mapear Supabase
      ↓
definir autoridade da regra
      ↓
refatorar incrementalmente
      ↓
validar
      ↓
atualizar codemap/documentação
```

Não mover código de vários domínios apenas para atingir uma estrutura “bonita”. Organização é consequência de ownership claro e baixo acoplamento.

## 19. Documentos oficiais

- `/AGENTS.md`
- `/docs/BUSINESS-RULES.md`
- `/docs/PWA-FUNCTIONAL-BASELINE.md`
- `/docs/FLOWS.md`
- `/docs/AI-CODEMAP.md`
- `/docs/MIGRATION-MAP.md`
- `/docs/EVOLUTION-ROADMAP.md`

Quando houver divergência de regra funcional, `BUSINESS-RULES.md` prevalece sobre documentação histórica.
