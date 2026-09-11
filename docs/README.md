# Documentação oficial — Sra. Luck React

Use esta ordem para entender o projeto.

## Leitura obrigatória

1. [`../AGENTS.md`](../AGENTS.md) — contrato de engenharia e regras para IA.
2. [`BUSINESS-RULES.md`](./BUSINESS-RULES.md) — regras de negócio atuais.
3. [`PWA-FUNCTIONAL-BASELINE.md`](./PWA-FUNCTIONAL-BASELINE.md) — funcionalidades do sistema anterior que servem de baseline.
4. [`FLOWS.md`](./FLOWS.md) — fluxos ponta a ponta.
5. [`AI-CODEMAP.md`](./AI-CODEMAP.md) — onde localizar cada parte do código.
6. [`MIGRATION-MAP.md`](./MIGRATION-MAP.md) — migração PWA → React/Worker.
7. [`EVOLUTION-ROADMAP.md`](./EVOLUTION-ROADMAP.md) — evolução até o MVP.
8. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — estado arquitetural detalhado e riscos.

## Documentos complementares existentes

- `PRODUCT-OPERATING-MODEL.md` — modelo operacional criado durante a fase de migração; usar `BUSINESS-RULES.md` como fonte de verdade quando houver divergência.
- `PRESERVAR-FUNCIONALIDADES.md` — notas de preservação anteriores; incorporadas de forma mais ampla em `AGENTS.md` e `PWA-FUNCTIONAL-BASELINE.md`.
- `ADMIN-REFINO-SEM-REGRESSAO.md` — regra específica de refino do admin.
- `LOGIN-VERCEL.md` e `VERCEL-PREVIEW-NOTES.md` — contexto técnico do Preview Vercel.

## Regra de atualização

Mudou regra de negócio? Atualize `BUSINESS-RULES.md`.

Mudou fluxo? Atualize `FLOWS.md`.

Mudou localização/arquitetura de código? Atualize `AI-CODEMAP.md`.

Migrou uma função do PWA? Atualize `MIGRATION-MAP.md`.

Mudou prioridade/fase do produto? Atualize `EVOLUTION-ROADMAP.md`.

A documentação faz parte da entrega; não é tarefa posterior.