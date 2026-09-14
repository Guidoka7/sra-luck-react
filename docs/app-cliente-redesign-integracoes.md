# Redesign do app da cliente — mapa de integrações

> Documento de trabalho do redesign visual (protótipo `Sra Luck App.dc.html`) do app
> da cliente. Mapeia cada tela/componente novo para a fonte real de dado, o
> endpoint/RPC/tabela que a alimenta, a ação administrativa que a altera e o
> mecanismo de atualização (polling/refetch). Atualizar sempre que uma peça for
> implementada ou uma decisão de arquitetura for tomada.

## Decisão de arquitetura (achado da auditoria)

O projeto tem **duas** implementações paralelas de jornada/Clube de Vantagens:

- **Legado, ativo no runtime** (`src/pages/AgendaPage.tsx`, montado em `/agenda`,
  `/app`, `/cliente`): `worker/client-agenda.ts` + `worker/client-boletos.ts`,
  tabelas `clientes`/`agendamentos`/`boletos`, chaves `pode_agendar`,
  `agenda_liberada`, `status_revisao_financeira`.
- **Novo `journey`**: `worker/journey.ts`, tabela `contratos_credito` (campo
  `etapa`), consumido hoje só dentro de `FluxoCirurgicoCliente.tsx` (com
  fallback silencioso para o legado quando a cliente não tem
  `contratos_credito`). `src/features/client/ClientCreditLiveApp.tsx` é um app
  paralelo **órfão** (não roteado) — não usar como referência de UI.

**Decisão**: o redesign visual é implementado dentro de `AgendaPage.tsx` /
`FluxoCirurgicoCliente.tsx` (o componente já resolve journey→legado
automaticamente). Nenhuma tela nova duplica essa resolução; toda tela lê o
estado normalizado que esses dois já produzem.

O backend do **Clube de Vantagens** já existe (`worker/credit-ops.ts` +
`supabase/migration_022_operacao_credito_ecossistema.sql`: `clube_recompensas`,
`cliente_pontos`, `cliente_pontos_eventos`, `indicacoes_clientes`,
`clube_resgates`) mas nunca foi exposto na experiência real da cliente. O
redesign conecta a UI nova a esse backend existente, endurecendo-o
(atomicidade, idempotência, tabela de benefícios não pontuáveis) em vez de
recriar um segundo esquema.

## Matriz tela → dado → fonte → ação do painel

| Tela/componente | Dado exibido | Fonte (hoje) | Endpoint/RPC/tabela | Ação do painel que altera | Atualização |
|---|---|---|---|---|---|
| Header Home (perfil sticky) | nome, procedimento, plano | `AgendaPage` | `GET /api/cliente/agenda`, `GET /api/cliente/boletos` | cadastro do cliente/contrato (admin clientes) | polling 30s |
| Card motivacional | procedimento, plano, % pago | idem | idem (`porcentagem_pagamento`) | pagamento de parcela confirmado (admin financeiro) | polling 30s |
| AgendaHome (estados A–H) | etapa da jornada, datas, custeio | `FluxoCirurgicoCliente` → `GET /api/cliente/journey` com fallback legado | `worker/journey.ts` / `worker/client-agenda.ts` | `worker/journey.ts` admin (`/api/admin/journey/*`), `worker/admin-surgery-flow.ts`, `worker/agendamento-acoes.ts` | polling do componente + refetch pós-ação |
| Parcelas — card "Parcelas pagas" + lista | status de cada boleto | `TabBoletos` → `GET /api/cliente/boletos` | tabela `boletos` | `worker/admin-financeiro.ts` (`financeiro_baixar_boleto`, `financeiro_validar_comprovante`), `worker/admin-parcelas.ts` | polling 30s |
| Bottom sheet pagamento — PIX | chave/QR | config de pagamento admin | `worker/client-agenda.ts` (`pagamento` em `/api/cliente/agenda`?) — ver `PagamentoConfig` em `TabBoletos` | configurações administrativas de pagamento | carregado com a página |
| Bottom sheet pagamento — Cartão | habilitado, taxa, total | **novo**: `CardPaymentConfig` | `GET /api/cliente/config` (novo campo `cartao`), `POST /api/cliente/pagamentos/cartao/sessao` | **novo**: painel `/admin/financeiro` (config cartão) | carregado com a página |
| Jornada — notificações compactas | últimas notificações | mesma fonte da Central | `GET /api/cliente/notificacoes` (**novo**, hoje inexistente) | eventos de backend (parcela, agenda, clube) | polling 15s + refetch em foco |
| Jornada — timeline | etapas concluídas/atual/próximas | derivado do estado normalizado da jornada | idem AgendaHome | idem AgendaHome | idem |
| Notificações (tela cheia) | lista completa, marcar lida(s) | tabela `notificacoes_cliente` | `GET /api/cliente/notificacoes`, `POST /:id/ler`, `POST /ler-todas` (**novos handlers no worker**) | eventos administrativos (parcela validada/rejeitada, agenda liberada, resgate aprovado, indicação confirmada) | polling 15s + refetch em foco |
| Clube — saldo/moedinha | saldo de pontos | `cliente_pontos` | `GET /api/cliente/credit-ops/club` | ajuste manual admin (**novo endpoint**) | ao abrir a tela |
| Clube — histórico | `cliente_pontos_eventos` | idem | idem | resgates/indicações/bônus geram evento | idem |
| Clube — indicações | status da indicação | `indicacoes_clientes` | `POST /api/cliente/credit-ops/referrals` | fila admin confirmar/rejeitar (**novo endpoint**) | ao abrir a tela |
| Clube — prêmios/resgate | catálogo, custo, disponibilidade | `clube_recompensas` | `GET .../club`, `POST /api/cliente/credit-ops/redeem` (tornar atômico via RPC) | CRUD catálogo admin (**novos endpoints** PATCH/DELETE) | ao abrir a tela |
| Clube — voucher 1ª parcela | benefício concedido 1x | **novo**: `clube_beneficios_cliente` | concedido dentro de `financeiro_baixar_boleto`/`financeiro_validar_comprovante` quando `numero_parcela = 1` | regra fixa + config de valor de bônus (admin) | evento de pagamento |
| Configurações/Mais | menu simplificado | estático + sessão | `POST /api/cliente/logout` | — | — |

## Pendências externas conhecidas

- Gateway de cartão de crédito real (tokenização/checkout) não está integrado;
  o contrato do servidor é implementado, mas `checkoutUrl` não aponta para um
  provedor real até a integração ser contratada.
