# Sra. Luck — Plataforma de crédito e jornada cirúrgica

`sra-luck-react` é o produto oficial em evolução da Sra. Luck.

A Sra. Luck atua como **facilitadora/intermediadora financeira** para clientes que contratam uma carta/crédito destinada a cirurgia programada. O sistema não deve ser modelado como software de clínica.

## Arquitetura alvo

- **React + Vite** — frontend SPA;
- **Cloudflare Workers** — backend/API, autenticação, regras protegidas e integrações;
- **Supabase** — PostgreSQL, Storage, Realtime, RPCs e persistência;
- **Vercel Preview** — validação rápida de interface por branch/commit;
- **GitHub Actions** — CI e validações.

O repositório `Guidoka7/sra-luck-pwa`, branch `main`, é a **baseline funcional histórica**. Ele deve ser consultado para preservar comportamentos aprovados enquanto o React reconstrói e evolui o produto.

## Documentação obrigatória para IA/engenharia

Antes de uma alteração relevante, ler:

1. [`AGENTS.md`](./AGENTS.md) — contrato de engenharia e regras para IA;
2. [`docs/BUSINESS-RULES.md`](./docs/BUSINESS-RULES.md) — fonte de verdade das regras atuais;
3. [`docs/PWA-FUNCTIONAL-BASELINE.md`](./docs/PWA-FUNCTIONAL-BASELINE.md) — o que o sistema anterior já faz e deve ser preservado/evoluído;
4. [`docs/FLOWS.md`](./docs/FLOWS.md) — fluxos operacionais ponta a ponta;
5. [`docs/AI-CODEMAP.md`](./docs/AI-CODEMAP.md) — onde localizar cada domínio no código;
6. [`docs/MIGRATION-MAP.md`](./docs/MIGRATION-MAP.md) — mapa PWA → React/Worker;
7. [`docs/EVOLUTION-ROADMAP.md`](./docs/EVOLUTION-ROADMAP.md) — sequência de evolução até MVP;
8. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — estado arquitetural e riscos conhecidos.

## Princípio de evolução

O projeto não é uma reescrita cega.

```text
PWA funcional
    ↓
entender comportamento e dependências
    ↓
reconstruir em React + Worker
    ↓
validar equivalência
    ↓
aplicar evolução aprovada
    ↓
validar + Preview
    ↓
remover legado somente quando seguro
```

Design, backend, fluxos e regras devem permanecer **maleáveis e fáceis de editar**. Políticas operacionais que podem mudar não devem ficar espalhadas como hardcode.

## Regras críticas já definidas

- Receita da Sra. Luck = **taxa administrativa** embutida nas parcelas.
- Percentual operacional = **parcelas pagas ÷ total de parcelas**, não valor pago ÷ contrato.
- O app da cliente preserva como referência as experiências **Minha Agenda** e **Meus Boletos** do PWA.
- Light/dark mode, configurações e notificações são capacidades permanentes, não descartáveis em redesign.
- A regra antiga de 90 dias após termos é legado quando conflitar com o fluxo novo.
- Regra atual: após **termos assinados + quitação confirmada**, a agenda cirúrgica é liberada após **5 dias úteis**, de acordo com a política vigente/configurável.

## Comandos principais atuais

```bash
npm ci
npm run dev
npm run lint
npm run build
npm run preview
```

O projeto deve ganhar/expandir testes automatizados como parte do hardening; não assumir que um script `npm test` exista sem conferir o `package.json` atual.

Use `npm run deploy` somente no fluxo de deploy explicitamente aprovado.

## Variáveis de ambiente

Frontend: somente variáveis públicas `VITE_*`.

Exemplo:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_REVIEW_URL=
```

Segredos como `SUPABASE_SERVICE_ROLE_KEY`, `CLIENTE_SESSION_SECRET`, tokens bancários, tokens de webhook e chaves privadas ficam exclusivamente no backend/Cloudflare Worker.

## Estrutura atual

```text
src/
  main.tsx
  pages/
  features/
  components/
  lib/
  types/
  styles/
  shims/
  app/          # ainda contém superfície herdada/legada

worker/
  index.ts
  *.ts          # handlers atuais em processo de modularização

supabase/
  ...           # migrations/schema/RPCs

docs/
  ...           # regras, arquitetura, fluxos e roadmap
```

A reorganização é incremental. Não mover ou apagar grandes blocos de legado sem provar equivalência funcional.

## Definition of Done

Uma função operacional não está pronta só porque existe na interface. Conforme aplicável, ela precisa de:

- UI real;
- validação;
- backend real;
- persistência;
- autenticação/permissão;
- tratamento de erro;
- auditoria/idempotência em fluxos críticos;
- testes adequados ao risco;
- TypeScript/lint/build verdes;
- validação em Preview quando houver impacto visual/operacional.

O objetivo é chegar a um **MVP publicável, funcional e profissional**, mantendo o projeto organizado para evolução contínua por IA e engenharia.