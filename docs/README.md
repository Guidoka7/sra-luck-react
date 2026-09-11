# Documentação oficial — Sra. Luck React

Use esta ordem para entender o projeto.

## Leitura obrigatória

1. [`../AGENTS.md`](../AGENTS.md) — contrato de engenharia e regras para IA.
2. [`BUSINESS-RULES.md`](./BUSINESS-RULES.md) — regras de negócio atuais.
3. [`PRODUCT-PRINCIPLES.md`](./PRODUCT-PRINCIPLES.md) — identidade, UX e padrão visual/operacional.
4. [`PWA-FUNCTIONAL-BASELINE.md`](./PWA-FUNCTIONAL-BASELINE.md) — funcionalidades do sistema anterior que servem de baseline.
5. [`FLOWS.md`](./FLOWS.md) — fluxos ponta a ponta.
6. [`AI-CODEMAP.md`](./AI-CODEMAP.md) — onde localizar cada parte do código.
7. [`MIGRATION-MAP.md`](./MIGRATION-MAP.md) — migração PWA → React/Worker.
8. [`EVOLUTION-ROADMAP.md`](./EVOLUTION-ROADMAP.md) — evolução até o MVP.
9. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — estado arquitetural detalhado e riscos.
10. [`FINANCEIRO-UNIFICADO.md`](./FINANCEIRO-UNIFICADO.md) — especificação da nova central financeira, migração de Pagamentos/Parcelas e preparação para bancos, RD Station, Conta Azul e Mercado Pago.
11. [`AUDIT-PWA-REACT-2026-09-11.md`](./AUDIT-PWA-REACT-2026-09-11.md) — auditoria inicial de equivalência, regressões e riscos P0–P3.

## Codex

- [`CODEX-BOOTSTRAP-PROMPT.md`](./CODEX-BOOTSTRAP-PROMPT.md) — primeira instrução recomendada para o Codex auditar e assumir o projeto sem criar funções superficiais.

Depois da auditoria inicial, cada tarefa do Codex deve partir de uma especificação coerente de frontend + backend + banco + critérios de aceitação.

## Documentos complementares existentes

- `PRODUCT-OPERATING-MODEL.md` — modelo operacional criado durante a fase de migração; usar `BUSINESS-RULES.md` como fonte de verdade quando houver divergência.
- `PRESERVAR-FUNCIONALIDADES.md` — notas de preservação anteriores; incorporadas de forma mais ampla em `AGENTS.md` e `PWA-FUNCTIONAL-BASELINE.md`.
- `ADMIN-REFINO-SEM-REGRESSAO.md` — regra específica de refino do admin.
- `LOGIN-VERCEL.md` e `VERCEL-PREVIEW-NOTES.md` — contexto técnico do Preview Vercel.

## Regra de atualização

Mudou regra de negócio? Atualize `BUSINESS-RULES.md`.

Mudou padrão visual/experiência? Atualize `PRODUCT-PRINCIPLES.md`.

Mudou fluxo? Atualize `FLOWS.md`.

Mudou localização/arquitetura de código? Atualize `AI-CODEMAP.md`.

Migrou uma função do PWA? Atualize `MIGRATION-MAP.md`.

Mudou prioridade/fase do produto? Atualize `EVOLUTION-ROADMAP.md`.

A documentação faz parte da entrega; não é tarefa posterior.