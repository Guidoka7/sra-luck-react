# Integrações — mapa do que cada API permite (2026-09-24)

Levantamento feito antes de implementar o padrão de integrações. Regra: nenhuma função
entra no painel como "disponível" sem existir na API do provedor **e** no código do Sra Luck.
Cada item abaixo está marcado como:

- **existe no Sra Luck**: já implementado e em uso;
- **API permite**: documentado pelo provedor, ainda não implementado;
- **API não permite**: não existe na API; exige outro caminho (manual, polling, etc.).

Fontes: documentação oficial (developers.contaazul.com, developers.rdstation.com,
ai.google.dev) e o código atual (`worker/integrations-*.ts`, `worker/rd-station-readonly.ts`,
`worker/frase-do-dia.ts`, `worker/notificacoes-lotes.ts`).

---

## 1. Gemini (Google AI Studio)

| Capacidade | Situação |
|---|---|
| `POST v1beta/models/{modelo}:generateContent` com instrução de sistema, JSON estruturado (`responseSchema`), temperatura e limite de tokens | existe no Sra Luck |
| `GET v1beta/models` (ListModels) para descobrir modelos da chave | existe no Sra Luck (fallback) |
| Chave por projeto; cota e limites por modelo definidos pelo Google (429 quando excede) | API permite (leitura do código de erro) |
| Webhooks / eventos | API não permite (chamada síncrona) |
| Consulta de uso/cota restante pela API | API não permite pela chave de API; o uso tem de ser contado pelo Sra Luck |

Funções do Sra Luck que chamam o Gemini hoje:

- **mensagem diária**: rotina (candidata aguardando aprovação), "pedir outra opção", teste de conexão (`worker/frase-do-dia.ts`);
- **notificações**: gerar mensagens do lote, conversa sobre o lote, "explicar este lote" (`worker/notificacoes-lotes.ts`).

Hoje as duas usam a **mesma** configuração (uma chave, um modelo, um prompt de estilo). Não há
liga/desliga nem limite por função; só existe o liga/desliga da integração inteira.

## 2. RD Station CRM (API v2, OAuth2)

| Capacidade | Situação |
|---|---|
| OAuth2 (authorize, token, refresh com rotação) | existe no Sra Luck |
| `GET /crm/v2/deals` paginado com filtro RDQL (hoje: `status:won`) | existe no Sra Luck |
| `GET /crm/v2/contacts`, `/users`, `/campaigns`, `/sources` | existe no Sra Luck |
| Webhook de entrada com segredo próprio e idempotência por `transaction_uuid` | existe no Sra Luck (`POST /api/integrations/rd-station/webhook`) |
| `GET /crm/v2/pipelines` e `GET /crm/v2/pipelines/{id}/stages` (escolher funil e etapa) | API permite |
| `GET /crm/v2/custom_fields` (escolher campos personalizados a importar) | API permite |
| Filtro RDQL por funil, etapa, status e data de alteração | API permite |
| Webhooks gerenciados por API (`/webhooks`: criar, listar, alterar, excluir; eventos `crm_deal_created`, `crm_deal_updated`, `crm_deal_deleted`, contatos etc.) | API permite |
| Escrever negociações/contatos no RD | API permite, **mas proibido pela regra do projeto** (fronteira somente leitura, `docs/AUDIT-RD-INTEGRACOES-2026-09-14.md` §5) |

Destino atual no Sra Luck: `novas_vendas` (staging com conferência humana), snapshot `rd_*`
preservando alterações locais; `rd_station_id` único evita duplicidade.

Não existe hoje: escolha de funil/etapa, escolha de campos, mapeamento configurável,
status interno de entrada configurável, sincronização agendada.

## 3. Conta Azul (API v2, OAuth2)

Autenticação: OAuth 2.0 authorization code (código válido por 3 min); limite de 600
chamadas/min e 10/s por conta conectada.

| Capacidade | Situação |
|---|---|
| `POST /v1/financeiro/eventos-financeiros/contas-a-receber` (evento + parcelas com vencimento, `valor_bruto`, `multa`, `juros`, `desconto`, `taxa`, método, conta financeira, contato) | existe no Sra Luck (manual, sem idempotência) |
| Resposta da criação: **202 com `protocolo`** (`PENDING`/`SUCCESS`/`ERROR`), **sem ID do evento** | limitação da API |
| `GET /v1/financeiro/eventos-financeiros/parcelas/{id}` (status `PENDENTE`, `QUITADO`, `CANCELADO`, `RENEGOCIADO`, `RECEBIDO_PARCIAL`, `ATRASADO`, `PERDIDO`; `valor_pago`, `nao_pago`, `baixas[]`, `renegociacao`, `versao`, `data_alteracao`) | API permite |
| `PATCH /v1/financeiro/eventos-financeiros/parcelas/{id}` com `versao` (vencimento, composição de valor, nota, descrição, método, conta financeira) | existe no Sra Luck (manual) |
| `GET /v1/financeiro/eventos-financeiros/{id}/parcelas` | API permite |
| Baixas: `POST .../parcelas/{parcela_id}/baixa`, `GET .../parcelas/{parcela_id}/baixa`, `GET/PATCH/DELETE .../parcelas/baixa/{baixa_id}` (data, composição com juros/multa/desconto/taxa, conta financeira, método, observação, NSU, anexos) | API permite |
| `GET /v1/financeiro/eventos-financeiros/alteracoes?data_inicio&data_fim` (IDs dos eventos alterados no período) | API permite — base do polling |
| Busca de receitas por filtro, incluindo data de alteração da parcela e `ids_clientes` | API permite |
| Pessoas: criar, buscar (com filtro por data de atualização), ativar/inativar | API permite |
| Contas financeiras, categorias, centros de custo | API permite (leitura) |
| **Webhooks** | **API não permite** ("ainda não está disponível nativamente"); o próprio FAQ indica polling |
| **Cancelar/excluir evento ou parcela** | **API não permite** (não há endpoint) |
| **Renegociar pela API** | **API não permite** (o objeto `renegociacao` é só leitura) |
| Campo livre de ID externo na criação | **API não permite**; a correspondência tem de ser feita pelo Sra Luck (marcador na nota/observação + gravação dos IDs retornados) |

Hoje o Sra Luck usa `CONTA_AZUL_ACCESS_TOKEN` de variável de ambiente, sem renovação
automática, e `conta_azul_operacoes` registra as chamadas. Auditoria anterior (P1.4) já
apontou a falta de idempotência antes da criação.

Consequências para o pedido de sincronização bidirecional:

- **Sra Luck → Conta Azul**: criar conta a receber, alterar vencimento/valores (com `versao`),
  registrar e estornar baixa — possível.
- **Conta Azul → Sra Luck**: não há webhook; só **polling** incremental (`alteracoes` + leitura
  das parcelas), com atraso igual ao intervalo escolhido.
- **Cancelamento, estorno de evento e renegociação feitos no Sra Luck** não podem ser
  replicados pela API: viram pendência manual na Conta Azul, registrada na fila.
- A correspondência exata exige guardar, por parcela, `id_evento`, `id_parcela` e `versao`
  da Conta Azul, descobertos depois da criação.

## 4. Regras do projeto que continuam valendo

- Mercado Pago: webhook nunca dá baixa; confirmação humana (`docs/AUDIT-RD-INTEGRACOES-2026-09-14.md` §4).
- RD Station: somente leitura dos dados comerciais (§5).
- Conta Azul: baixas idempotentes e vinculadas à parcela correta (`docs/BUSINESS-RULES.md` §9).
- Segredos só no cofre cifrado (`integracoes_credenciais`), editados no Admin; o Dev Console
  mostra somente o valor mascarado.

## 5. Padrão comum (arquitetura)

Cada integração é descrita num **registro** (`worker/integracoes-registro.ts`) com:
credenciais (do `CATALOGO_PROVEDORES`), funções (com situação real: disponível, API permite
mas não implementado, API não permite), origem e destino, mapeamento de campos, modos de
sincronização, webhooks de entrada/saída e limites. A configuração operacional (não secreta)
fica em `integracoes_config` por provedor e função, com versão e auditoria. Uma integração
nova entra adicionando uma entrada no registro — o Dev Console monta a tela a partir dele.
