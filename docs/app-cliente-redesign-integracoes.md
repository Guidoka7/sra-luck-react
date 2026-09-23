# Redesign do app da cliente — mapa de integrações

> Documento de trabalho do redesign visual (protótipo `Sra Luck App.dc.html`) do app
> da cliente, portado para o branch `develop` atual. Mapeia cada tela/componente
> novo para a fonte real de dado, o endpoint/RPC/tabela que a alimenta, a ação
> administrativa que a altera e o mecanismo de atualização (polling/refetch).

## Decisões de arquitetura

- **Jornada/Agenda**: `AgendaPage.tsx` continua sendo a experiência real da
  cliente (rotas `/agenda`, `/app`, `/cliente`). A lógica de negócio
  (`FluxoCirurgicoCliente`, `EscolherFormaPagamento`, `SolicitarLiberacaoFinanceira`,
  `client-agenda.ts`, `journey.ts`) **não foi alterada** — só a camada visual em
  volta (header, navegação, posicionamento na Home) foi reconstruída.
- **Cartão de crédito**: já existe uma integração real via Mercado Pago
  (`worker/integrations-core.ts`, `POST /api/cliente/payments/mercado-pago/preference`,
  credenciais cifradas via painel de Integrações, taxa por cliente em
  `clientes.financeiro_taxa_cartao`). O redesign **não introduz um sistema de
  cartão paralelo** — o botão "Cartão" em `TabBoletos.tsx` já chama esse fluxo.
- **Clube de Vantagens**: a antiga `migration_022_operacao_credito_ecossistema.sql`
  continha as estruturas do Clube junto de um subsistema maior de crédito/agenda,
  mas ela não consta no histórico aplicado do projeto real. Para não habilitar
  aquele subsistema paralelo, esta entrega usa a `migration_048_clube_endurecimento.sql`,
  que provisiona somente o subconjunto necessário ao Clube, com acesso direto
  bloqueado para `anon`/`authenticated`, resgate atômico via RPC `clube_resgatar`
  e bônus idempotente da primeira parcela. O bônus/notificação é acionado por um
  trigger específico de mudança de status em `boletos`, sem substituir as RPCs
  financeiras existentes e sem interferir no Mercado Pago. **A administração do
  Clube (`/admin/clube`) fica fora desta entrega** — módulo com especificação
  própria a definir depois.

## Matriz tela → dado → fonte → ação do painel

| Tela/componente | Dado exibido | Fonte (hoje) | Endpoint/RPC/tabela | Ação do painel que altera | Atualização |
|---|---|---|---|---|---|
| Header Home (perfil sticky) | nome, procedimento, plano | `AgendaPage` | `GET /api/cliente/agenda`, `GET /api/cliente/boletos` | cadastro do cliente/contrato (admin clientes) | polling 30s |
| Card motivacional | procedimento, plano, % pago | idem | idem (`porcentagem_pagamento`) | pagamento de parcela confirmado (admin financeiro) | polling 30s |
| AgendaHome (estados A–H) | etapa da jornada, datas, custeio | `FluxoCirurgicoCliente` (journey) + `conteudoAgendaLegado` (agenda legado, com `EscolherFormaPagamento`) | `worker/journey.ts` / `worker/client-agenda.ts` | `worker/journey.ts` admin, `worker/admin-surgery-flow.ts`, `worker/agendamento-acoes.ts` | polling do componente + refetch pós-ação |
| Parcelas — card "Parcelas pagas" + lista | status de cada boleto | `TabBoletos` → `GET /api/cliente/boletos` | tabela `boletos` | `worker/admin-financeiro.ts` (`financeiro_baixar_boleto`, `financeiro_validar_comprovante`), `worker/admin-parcelas.ts` | polling 30s |
| Bottom sheet pagamento — PIX | chave/QR | `GET /api/cliente/config` (novo, subconjunto seguro de `configuracoes`) | tabela `configuracoes` | Configurações administrativas de pagamento | carregado com a página |
| Bottom sheet pagamento — Cartão | checkout | `POST /api/cliente/payments/mercado-pago/preference` (já existente) | `clientes.financeiro_taxa_cartao` + credenciais Mercado Pago | Revisão financeira (taxa) + painel de Integrações (credenciais) | ação do usuário |
| Jornada — notificações compactas | últimas notificações | mesma fonte da Central | `GET /api/cliente/notificacoes` (**novo**, antes inexistente) | eventos de backend (parcela, clube) | polling 15s + refetch em foco |
| Jornada — timeline (8 etapas) | etapas concluídas/atual/próximas | `deriveJourneySteps` (extraído de `JourneyTracker.tsx`, removido da Home) | `GET /api/cliente/agenda` + `GET /api/cliente/journey` | idem AgendaHome | idem |
| Notificações (tela cheia) | lista completa, marcar lida(s) | tabela `notificacoes_cliente` | `GET /api/cliente/notificacoes`, `POST /:id/ler`, `POST /ler-todas` (**novos handlers**) | eventos administrativos (parcela validada/rejeitada, resgate solicitado) | polling 15s + refetch em foco |
| Clube — saldo/moedinha | saldo de pontos | `cliente_pontos` | `GET /api/cliente/credit-ops/club` (enriquecido) | — (sem admin ainda) | ao abrir a tela |
| Clube — histórico | `cliente_pontos_eventos` | idem | idem | resgates/bônus geram evento | idem |
| Clube — indicações | status da indicação | `indicacoes_clientes` | `POST /api/cliente/credit-ops/referrals` | — (confirmação fica para o módulo admin) | ao abrir a tela |
| Clube — prêmios/resgate | catálogo, custo, disponibilidade | `clube_recompensas` | `GET .../club`, `POST /api/cliente/credit-ops/redeem` (atômico via RPC `clube_resgatar`) | — (catálogo hoje só via `POST /api/admin/credit-ops/rewards`, já existente) | ao abrir a tela |
| Clube — voucher 1ª parcela | benefício concedido 1x | `clube_beneficios_cliente` | trigger `trg_clube_notificar_boleto_status` → `clube_conceder_bonus_primeira_parcela` quando a parcela 1 passa para `pago` | regra fixa (`clube_config`) | evento de pagamento |
| Configurações/Mais | menu simplificado | estático + sessão | `POST /api/cliente/logout` | — | — |

## Pendências / fora de escopo desta entrega

- Painel administrativo do Clube (`/admin/clube`): **entregue** para
  indicações (status + vínculo da cliente indicada), vouchers (anexar arquivo)
  e pontuação. Ainda pendentes: gestão do catálogo com fotos (perfil dev) e
  fila de resgates.
- Crédito de indicação: **ativo** desde a migration 075 (Fechou + 1ª parcela
  paga da indicada → 200 pontos para quem indicou).
