# Auditoria PWA → React/Worker — 2026-09-11

## Objetivo

Registrar o estado técnico comprovável da migração do `sra-luck-pwa` para o produto oficial `sra-luck-react`, sem alterar comportamento funcional, banco de produção ou integrações.

Esta auditoria deve ser lida junto com:

- `AGENTS.md`
- `docs/BUSINESS-RULES.md`
- `docs/PRODUCT-PRINCIPLES.md`
- `docs/PWA-FUNCTIONAL-BASELINE.md`
- `docs/FLOWS.md`
- `docs/MIGRATION-MAP.md`

## Regras usadas como fonte de verdade

1. Sra. Luck é facilitadora/intermediadora financeira, não clínica.
2. Elegibilidade operacional = **quantidade de parcelas pagas / total de parcelas**.
3. A lógica histórica de 90 dias após termos é obsoleta quando conflitar com a regra atual.
4. Agenda cirúrgica: **termos assinados + quitação confirmada + 5 dias úteis**.
5. Nenhuma função é considerada pronta apenas por existir no frontend: deve haver UI → validação → autorização → endpoint → regra → persistência → auditoria/evento → feedback.

## Resultado executivo

A migração possui base funcional relevante, mas ainda há riscos de segurança, integridade operacional e duplicidade de regra que impedem considerar a plataforma consolidada.

### P0 — segurança / acesso indevido

#### P0.1 — autenticação administrativa não prova papel administrativo

`worker/index.ts` autentica email/senha via Supabase Auth e emite `admin_session` para qualquer usuário autenticado com sucesso. Não há, nesse fluxo, comprovação de papel/perfil administrativo antes da emissão do token.

`worker/admin-auth.ts` e handlers administrativos validam a assinatura/validade de `admin_session`, mas não demonstram uma segunda checagem de autorização por papel.

**Risco:** um usuário Supabase Auth sem papel administrativo pode receber sessão administrativa.

**Próxima correção recomendada:** RBAC real no backend, com fonte de verdade persistida e checagem antes de criar a sessão e antes de operações sensíveis.

## P1 — regra de negócio / integridade financeira

#### P1.1 — regra de 90 dias ainda existe em runtime legado

`worker/admin-finance.ts` ainda calcula datas usando `dataTermos + 90 dias` em parte do fluxo de previsão/liberação.

Isso conflita com a regra oficial: termos assinados + quitação confirmada → 5 dias úteis → agenda cirúrgica liberada.

**Risco:** telas ou previsões administrativas podem apresentar decisão diferente da jornada oficial.

**Ação:** remover dependência funcional dos 90 dias e consolidar a regra em uma única fonte de domínio.

#### P1.2 — elegibilidade: migration histórica monetária e substituição final por parcelas

`supabase/migration_023_fluxo_termos_e_agenda.sql` contém uma versão histórica de `vw_previsao_elegibilidade` baseada em valor financeiro acumulado.

`supabase/migration_026_elegibilidade_por_parcelas.sql` posteriormente derruba e recria a view pela regra oficial de quantidade de parcelas, usando `ceil(total_parcelas * percentual_minimo / 100)`.

Portanto:

- `migration_023` = **histórica / obsoleta para a regra final**;
- `migration_026` = **substituição final pretendida no repositório**.

**Estado efetivamente aplicado no Supabase:** **NÃO FOI POSSÍVEL CONFIRMAR nesta auditoria**.

Não presumir que a sequência do repositório equivale ao schema atualmente aplicado. Fazer auditoria de schema/migrations antes de qualquer aplicação automática.

#### P1.3 — Mercado Pago ainda não fecha a baixa operacional da parcela

`worker/integrations-core.ts` cria preferência vinculada ao boleto e trata webhook com validação de assinatura e registro de eventos. O pagamento aprovado é persistido em `pagamentos_externos` com `status_validacao = aguardando_validacao`.

Não foi comprovado, no fluxo auditado, o encadeamento completo e idempotente:

pagamento aprovado → validação humana → baixa exata da parcela → recálculo de jornada → auditoria → feedback.

**Risco:** pagamento aprovado existir na integração sem produzir a baixa operacional esperada.

#### P1.4 — Conta Azul sem guarda idempotente comprovada antes da criação

No fluxo de criação de contas a receber em `worker/integrations-core.ts`, uma operação é registrada e em seguida é feito POST no provedor. Não foi comprovada uma guarda de idempotência anterior à chamada externa para impedir criação duplicada em retry/reexecução.

**Risco:** duplicidade de recebível externo em falha de rede, retry ou repetição operacional.

## P2 — regressão funcional / arquitetura incompleta

#### P2.1 — `/equipe` usa papel local e dados não confiáveis para autorização

`src/features/staff/StaffPwa.tsx` lê o papel de `localStorage` (`sra-staff-role`). Estado local pode servir a protótipo visual, nunca a autorização.

Além disso, a área ainda precisa ser tratada como parcial até existir cadeia real de identidade, papel, dados, comissão e permissão no backend.

**Ação:** papel vem da sessão/backend; frontend apenas renderiza o que foi autorizado.

#### P2.2 — Web Push apresenta CTA sem cadeia backend comprovada

`src/components/cliente/AtivarNotificacoesPush.tsx` chama:

- `/api/cliente/push/vapid`
- `/api/cliente/push/subscribe`

Essas rotas não foram comprovadas no Worker atual durante a auditoria.

Em `worker/admin-notificacoes.ts`, o envio manual registra a notificação em banco, mas retorna `push.enviadas = 0`, sem envio push efetivo comprovado.

**Risco:** interface comunica ativação/envio de push sem capacidade operacional ponta a ponta.

#### P2.3 — duas famílias concorrentes de jornada/operação de crédito

O Worker possui `credit-ops.ts` e `journey.ts`, além de handlers legados de agenda/financeiro que ainda contêm regras relacionadas ao mesmo processo.

Há sobreposição de responsabilidade entre jornada, liberação, agenda e financeiro.

**Risco:** corrigir regra em um handler e deixar outro com comportamento divergente.

**Ação:** definir domínio canônico e migrar consumidores incrementalmente, sem rewrite gigante.

#### P2.4 — migrations com prefixos numéricos repetidos

O diretório `supabase/` contém prefixos repetidos, por exemplo famílias `migration_010_*` e `migration_011_*` distintas.

Não renomear migrations históricas às cegas: isso pode quebrar rastreabilidade. O primeiro passo é mapear ordem aplicada e drift real do banco.

## P3 — dívida técnica / confirmação pendente

- Existem componentes e artefatos herdados do PWA/Next ainda presentes como referência ou compatibilidade; remoção só após prova de equivalência.
- Configurações locais de tema, telemetria e UX podem continuar usando `localStorage` quando não representam autorização/regra de negócio.
- Integrações devem evoluir para providers isolados, com contrato, idempotência, erros e testes de webhook.
- Toda área que não pôde ser provada ponta a ponta permanece **PARCIAL** ou **NÃO FOI POSSÍVEL CONFIRMAR**.

## Matriz resumida

| Domínio | Estado auditado | Observação |
| --- | --- | --- |
| Login cliente | React/Worker existente | precisa E2E autenticado |
| Login admin | **risco P0** | autentica Auth, mas papel admin não está comprovado |
| Minha Agenda | migração em andamento | preservar UX PWA e consolidar regra nova |
| Meus Boletos | portado/parcial | upload e fluxo precisam E2E |
| Clientes | parcial | manter equivalência funcional |
| Parcelas | parcial | backend existe; validar ações críticas |
| Elegibilidade | regra nova implementada em código/migration 026 | schema aplicado não confirmado |
| Levantamento financeiro | parcial | consolidar em jornada canônica |
| Termos | parcial | nova jornada existe, legado ainda interfere |
| Agenda cirúrgica | **conflito P1** | 5 dias úteis vs lógica 90 dias ainda ativa |
| Equipe | **parcial P2** | papel local não pode autorizar |
| Notificações | parcial | logs existem; Web Push não comprovado |
| Mercado Pago | parcial P1 | checkout/webhook existem; baixa final não comprovada |
| Conta Azul | parcial P1 | chamada existe; idempotência externa não comprovada |
| RD Station | fundação existente | staging/eventos; precisa homologação |
| Banco/provedores | fundação/parcial | não considerar integrado sem E2E real |
| Forecast | parcial | regra deve ser sempre por quantidade de parcelas |
| Migrations | risco de drift | prefixos repetidos e estado aplicado não confirmado |

## Checks executados na auditoria original

- `npm run lint`: **PASSOU**.
- `npm run build`: **NÃO FOI POSSÍVEL CONFIRMAR** no sandbox local do Codex porque o ambiente bloqueou o `esbuild` antes da compilação.
- Confirmação de build deve vir do CI do GitHub após publicação da branch.

## Ordem recomendada de correção

1. **P0 — autorização administrativa / RBAC**.
2. **P1 — consolidar drift de schema e elegibilidade por parcelas**.
3. **P1 — remover regra ativa de 90 dias e consolidar 5 dias úteis**.
4. **P2 — identidade/permissão real da Equipe**.
5. **P2 — Web Push ponta a ponta**.
6. **P1 — Mercado Pago: validação + baixa idempotente da parcela**.
7. **P1 — Conta Azul: chave idempotente + retry seguro + reconciliação**.
8. Consolidar famílias de jornada e reduzir handlers duplicados gradualmente.

## Restrições desta auditoria

Esta entrega é **somente documental**.

Não:

- aplica migration;
- altera produção;
- corrige regra em runtime;
- remove legado;
- redesenha telas;
- cria função superficial;
- presume estado não comprovado.

Qualquer item sem evidência suficiente deve permanecer explicitamente como **NÃO FOI POSSÍVEL CONFIRMAR** até uma auditoria técnica específica provar o contrário.
