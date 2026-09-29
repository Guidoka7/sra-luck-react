# Diagnóstico da importação do RD Station — 28/09/2026

Análise **somente leitura** da produção (`sbohknqapprimtspczio`), sem dados pessoais. IDs técnicos
mascarados como `rd-<md5[0:10]>` (negociação) e `imp-<md5[0:8]>` (execução). Nada foi alterado.

Queixa: clientes com falha não aparecem para conferência em lugar nenhum.

## 1. Números

### 1.1 Execuções (`integracao_importacoes`, 3.065 linhas)

| Origem | Status | Execuções | Motivo | Janela |
|---|---|---|---|---|
| agendada | erro | **75** | `RD_ACCESS_TOKEN_MISSING` (todas) | 24/09 20:22 → 25/09 15:00 UTC |
| agendada | concluida | 38 | — | 25/09 → 26/09 |
| manual | erro | 1 | `EXECUTION_TIMEOUT_504` (imp-e58e8545) | 25/09 15:12 |
| manual | **em_andamento para sempre** | 1 | nunca terminou (imp-91c9b18b) | 25/09 15:20 |
| manual | concluida | 6 | — | 25/09 → 28/09 |
| webhook | concluida | 2.944 | uma "execução" por evento recebido | 25/09 → 28/09 |

Correção do número citado antes: "119 importações agendadas" estava errado. São **113 agendadas**
(75 com erro + 38 concluídas); o 119 somava as 6 manuais concluídas. Webhooks não entram nessa conta.

### 1.2 Itens por negociação (`integracao_importacao_itens`)

| Resultado | Itens | Negociações | Observação |
|---|---|---|---|
| criada | 295 | 295 | 264 agendadas + 31 manuais |
| ignorada | 2.870 | **189** | todas via webhook, motivo "Fora dos funis configurados" |
| erro | **0** | 0 | o código grava `erro`, mas nunca aconteceu |
| duplicada | **0** | 0 | ver §2.6: a deduplicação não tem chave para comparar |
| cliente_existente | **0** | 0 | idem |
| atualizada | 0 gravados | — | 15.609 atualizações existem só nos totais; o código descarta o item |

### 1.3 Vendas criadas (`novas_vendas`, 1.209)

| Situação | Vendas | Amostra mascarada |
|---|---|---|
| vieram da execução que nunca terminou (sem nenhum item) | **914** | rd-48f51862be, rd-75a4bfb7ae, rd-a13b2cb4c5 |
| **CPF ausente** | **1.209 (100%)** | — |
| quantidade de parcelas ausente | 1.209 (100%) | — |
| vendedora com nome do RD, mas **sem vínculo com a equipe** (`vendedora_id` nulo) | 1.209 (100%) — 18 usuários RD distintos, 2 pessoas cadastradas como vendedora/SDR | — |
| valor ≤ 0 | **336** | rd-48f51862be, rd-31ded419d5, rd-dcf9429304, rd-e5d4d9bf1e |
| sem telefone **e** sem e-mail | 853 | — |
| status no RD **perdida** (`lost`) | 13 | rd-775947aec0 |
| status no RD **em andamento** (`ongoing`) | 23 | rd-94e911956a, rd-150ff6c4cf |
| ganhas (`won`) | 1.173 | — |

### 1.4 Negociações fora da configuração

- 189 negociações chegaram só pelo webhook e são de um **terceiro funil** (`pipe-d1457b`) que não está
  na configuração (a configuração tem `pipe-6ef05c` e `pipe-a874f6`).
- Destas, **9 estão ganhas no RD**; **7 não têm venda em lugar nenhum**: rd-bc2fe9803f, rd-e10bccbda3,
  rd-dbbdd94f1d, rd-f40cc0727f, rd-0f7c0d8b71, rd-65dea33124, rd-c0e7057418.
- 174 em andamento, 6 perdidas.
- `crm_vendas_entrada` tem 2.944 linhas "aguardando_conferencia" (202 negociações); 186 negociações
  não têm venda, e 187 delas são exatamente essas ignoradas por funil.

## 2. Rastreamento: API do RD → tabelas → tela

```
RD API (deals, contacts, users)             webhook do RD (evento por negociação)
        │ listarTudo / listarSeguro                 │ processarWebhookRd
        ▼                                           ▼
importarCrm (agendada/manual)             importarDoWebhook (1 execução por evento)
  ├─ insert integracao_importacoes (em_andamento)     ├─ insert integracao_importacoes
  ├─ para cada deal: processarNegociacao              ├─ processarNegociacao
  │     ├─ insert novas_vendas (criada)  ← imediato   ├─ itens (menos "atualizada")
  │     └─ item em memória                            └─ insert crm_vendas_entrada "aguardando_conferencia"
  ├─ gravarItens (SÓ NO FIM)
  └─ update status/totais
        ▼
Tela Admin › Integrações (IntegracoesOperacao.tsx)
  ├─ histórico: 30 últimas execuções (sem filtro de origem)
  ├─ revisão: só itens duplicada/cliente_existente não revisados
  └─ Clientes › Aguardando cadastro: novas_vendas.status = aguardando_cadastro
```

### 2.1 Falha da execução inteira (75 agendadas + 1 manual 504)
A leitura do RD falhou antes de qualquer negociação (`catch` geral de `importarCrm`), sem item.
**Nenhuma negociação se perdeu por isso**: cada execução agendada relê todas as negociações dos
funis (300 a 547 por execução), e as execuções depois de 25/09 15:33 leram tudo de novo.
**Por que não aparece:** o histórico mostra as 30 execuções mais recentes, e as 30 mais recentes são
**todas webhook**. O erro mais recente está na posição 3.038.

### 2.2 Execução interrompida (imp-91c9b18b)
A função passou do tempo limite no meio do laço. As vendas já inseridas ficaram (914), mas os itens
só seriam gravados no fim e a execução nunca foi marcada como encerrada.
**Por que não aparece:** a execução mostra 0 itens e totais vazios; nada indica que criou 914 vendas.
As vendas existem em "Aguardando cadastro", mas sem vínculo visível com o que aconteceu.

### 2.3 Negociação ignorada por funil (189)
`passaNoFiltro` → item `ignorada`. **Por que não aparece:** a revisão só lista `duplicada` e
`cliente_existente`; os itens `ignorada` ficam presos em execuções de webhook (uma por evento, a
mesma negociação repetida até 83 vezes) que o histórico nem mostra. `crm_vendas_entrada` guarda o
evento como "aguardando_conferencia", mas **nenhuma tela lê essa tabela** para conferência; o status
nunca muda. As 7 ganhas sem venda são casos que exigem ação e hoje são invisíveis.

### 2.4 Negociação sem registro válido ou sem nome
`normalizarDealRd` sem ID → `continue` **sem item**; sem nome → `ignorada`. Hoje 0 casos, mas o
caminho é silencioso.

### 2.5 Falha de uma negociação específica
`try/catch` por negociação grava item `erro` ("Falha inesperada ao processar"). Hoje 0 casos. Se
ocorrer, **não aparece**: a revisão não lista `erro`.

### 2.6 Venda incompleta (vendedora, valor, CPF, parcelas)
A venda é criada mesmo sem CPF, sem parcelas, com valor 0, com status perdido/em andamento e sem
vendedora vinculada; o item diz "criada". **Nada marca a venda como incompleta.** Sem CPF (e com 853
sem telefone e e-mail), a deduplicação por CPF/telefone/e-mail não tem o que comparar — por isso 0
duplicadas não prova que não há duplicidade.
Causa provável do CPF: o mapeamento procura "cpf/documento/cpf cliente" no **contato**; o registro
guardado tem só a negociação e os campos personalizados dela (nenhum CPF entre eles). **A confirmar
com o time:** em qual campo do RD está o CPF.

## 3. Proposta: fila de pendências no Dev Console

Uma linha por **negociação + tipo** (não por evento), com contagem de ocorrências.

| Tipo | Quando | Ação necessária | Conta como venda válida? |
|---|---|---|---|
| `execucao_falhou` | execução inteira falhou (token, timeout, API) | corrigir a conexão no Console e reprocessar | — |
| `execucao_interrompida` | execução passou do tempo sem encerrar | reprocessar; conferir vendas criadas nela | — |
| `negociacao_com_erro` | falha ao processar uma negociação | reprocessar a negociação | não |
| `campos_ausentes` | venda sem CPF, valor ≤ 0, sem parcelas | completar no Admin (cadastro) e reprocessar | **não** |
| `vendedora_nao_vinculada` / `sdr_nao_vinculado` | usuário RD sem pessoa da equipe | vincular no Admin › Equipe e reprocessar | **não** |
| `status_nao_ganha` | venda criada com negociação perdida/em andamento | confirmar ou descartar | **não** |
| `ganha_fora_do_funil` | negociação ganha num funil não configurado | incluir o funil ou importar manualmente | **não** |
| `duplicidade_possivel` | mesmo CPF/telefone/e-mail de outra venda/cliente | escolher: mesma pessoa ou importar | **não** |

> Atualização 29/09/2026 (migration_116): o vínculo com a equipe passou a ser **opcional**; `vendedora_nao_vinculada` não é mais aberta e não tira a venda do BI.

Cada linha: tipo, motivo, campos faltantes, origem (agendada/manual/webhook), execução, negociação
(`rd_station_id`), venda, primeira e última ocorrência, número de ocorrências, estado
(aberta/resolvida/descartada), quem resolveu e quando.

Regras:
- **Reprocessar é seguro:** relê a negociação e usa a mesma chave `rd_station_id` (única) — nunca cria
  outra venda; só atualiza o snapshot e recalcula as pendências dela. A pendência fecha sozinha
  quando a causa some (`resolvida_pela_origem`).
- **Descartar** exige motivo e fica auditado.
- Venda válida para o BI = negociação ganha, vendedora vinculada, valor > 0, CPF válido e nenhuma
  pendência aberta. Tudo o mais aparece em "a conferir".
- Os dados existentes são preservados: as 1.209 vendas continuam onde estão; a fila é **calculada** a
  partir delas e das execuções, sem reimportar nada.
- Permissões: ver — todos do Console (viewer+); reprocessar — owner/developer/operator; descartar —
  owner/developer/operator com motivo; vincular vendedora e completar cadastro — no App, com
  `equipe.gerenciar` / `clientes.editar`.

Correções de código propostas (App, enquanto a coleta do RD ainda roda nele):
1. Gravar itens **durante** a execução (em lotes) e marcar como `erro: EXECUCAO_INTERROMPIDA` a
   execução em andamento que passou do prazo da trava.
2. Nunca descartar negociação em silêncio (sem ID vira pendência).
3. Registrar o resultado de cada negociação na fila de pendências de forma idempotente (webhook
   repetido só incrementa a ocorrência).
4. Histórico sem as execuções de webhook por padrão; resumo por tipo de pendência.
5. `crm_vendas_entrada` deixa de gravar "aguardando_conferencia" para tudo: o status passa a refletir
   o resultado (convertido/ignorado/erro).
6. Vínculo usuário RD ↔ pessoa da equipe e cálculo de `vendedora_id`.

## 4. Correção implementada e validada no QA isolado (28/09/2026)

Nada foi aplicado em Production. RD simulado no QA (fontes injetáveis do próprio código, dados fictícios).

| Item | Onde | Prova no QA |
|---|---|---|
| Fila `integracao_pendencias` + regra única de venda completa | `migration_113` (RPC `rd_recalcular_pendencias_venda`, view `vw_vendas_validas_bi`) | J17: 30/30 provas; BI = gabarito independente |
| Falha de execução agrupada (3 falhas de token → 1 pendência, 3 ocorrências) e fechada pela origem | `worker/crm-importacao.ts` | J17 |
| Execução interrompida marcada `EXECUCAO_INTERROMPIDA`; itens gravados em lotes durante o laço | `worker/crm-importacao.ts` | J17 |
| Negociação sem ID vira pendência com chave estável (não duplica por execução) | `worker/crm-importacao.ts` | J17 |
| `custom_fields` como objeto `{slug: valor}` (parcelas passam a ser lidas); CPF do contato | `worker/rd-station-readonly.ts` | J17 |
| `crm_vendas_entrada` com status real (convertido/ignorado/erro) | `worker/rd-station-readonly.ts` | J17 |
| Histórico sem execuções de webhook por padrão | `worker/crm-importacao.ts` | J17 |
| Revisão de duplicidade: **uma linha por negociação** ("vista em N execuções"); decisão fecha todas as repetições e a pendência; "mesma pessoa" não volta na próxima execução | `worker/crm-importacao.ts`, Admin | J17 + J18 (tela) |
| Vínculo responsável do RD ↔ vendedora/SDR por ID estável, em Admin › Clientes › Importações do RD (`equipe.gerenciar`); fecha a pendência sozinho | `worker/integracao-pendencias.ts`, `worker/admin-rotas-dev.ts`, Admin | J18 (tela) |
| Fila no Dev Console: ver (viewer+), reprocessar/descartar com motivo (owner/developer/operator); duplicidade só na revisão (409); falha do RD mantém a pendência aberta (502) | Console `pendencias.html` | J18: 8/8 casos RBAC, telas viewer/operator |

Reprocessar nunca cria outra venda: usa a chave única `rd_station_id`. Reimportar não duplica vendas
nem pendências (J17 `repeticaoNaoDuplicaVendasNemPendencias`).
