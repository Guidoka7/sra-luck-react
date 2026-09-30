# Integrações — mapa do que cada API permite (2026-09-24, atualizado com CRM e Conta Azul)

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

## 6. Implementado em 2026-09-24 (migration_091)

Fontes conferidas para esta etapa: OpenAPI oficial da Conta Azul (financeiro e baixas),
páginas de OAuth (login.contaazul.com, api-v2.contaazul.com/oauth/token, refresh rotativo,
error_subtype), changelog da Conta Azul (sem webhooks; /alteracoes desde 2026-03-31) e a
referência v2 do RD CRM (pipelines, /pipelines/{id}/stages, custom_fields com slug, RDQL).

### CRM (RD Station) — `worker/crm-importacao.ts`

| Pedido | Como ficou |
|---|---|
| Funil e etapa | Config `rd_station.importacao`: funil (`pipeline_id`), etapas (`stage_id:(…)`), status. Listas lidas do RD na hora (`GET …/rd-station/opcoes`). |
| Campos e mapeamento | Cada campo do Sra Luck: automático, `deal:<slug>`, `contact:<slug>` ou ignorar. Nome sempre importado. |
| Deduplicação | CPF, telefone (celular com/sem 9 e +55 viram a mesma chave; fixo não colide com celular) e e-mail, contra clientes (não arquivadas) e vendas pendentes. Duplicidade não cria nem altera nada: vai para revisão ("importar mesmo assim" / "é a mesma pessoa"). |
| Aguardando cadastro | Toda venda nova é gravada com `status = aguardando_cadastro`. A importação nunca cria cliente nem encaminha ao Financeiro. |
| Avançar só com financeiro + app | Gatilho `trg_novas_vendas_avancar`: `aguardando_boletos → financeiro_concluido` só quando a cliente tem parcelas **e** `acesso_app_liberado`. |
| Sincronização automática | Frequência 15 min a 24 h; o agendador (pg_cron a cada 15 min → `/api/cron/integracoes`) roda quando venceu. Manual e webhook usam o mesmo fluxo. |
| Histórico | `integracao_importacoes` + `integracao_importacao_itens` (dados pessoais mascarados nas telas). |

### Conta Azul — `worker/conta-azul.ts` e `worker/conta-azul-vinculos.ts` (30/09/2026)

**A Conta Azul é a única fonte da confirmação de pagamento.** O Sra Luck só LÊ a Conta Azul; o
cliente HTTP aceita só `GET` (e `DELETE /oauth/connections/{id}` para revogar a conexão) e recusa
qualquer outra chamada antes de sair do servidor (`escrita_bloqueada`; guardrail em
`integrations-guardrails.test.ts`). Nada de baixa, estorno, pagamento, lançamento ou alteração lá.

| Pedido | Como ficou |
|---|---|
| OAuth com renovação | Dev Console → Central: Client ID/Secret, Redirect URI, ambiente e URLs; Conectar e (App de Desenvolvimento) Concluir conexão com o endereço de retorno. Token renovado 2 min antes de vencer, com trava; `access_revoked`/`invalid_refresh_token` pedem reconexão. |
| Pessoa | CPF da cliente → `GET /v1/pessoas?documentos=` (documento idêntico) → confirmação humana → `cliente_vinculos_externos`. Nunca só por nome. |
| Parcela | `conta_azul_vinculos`: parcela ↔ parcela/evento da Conta Azul (IDs persistidos). Conferência mostra correspondências, divergências (valor, vencimento, status), só no Sra Luck e só na Conta Azul; divergência só vincula com aceite, sem alterar nada. |
| Financeiro que nasce da Conta Azul | Cliente sem parcelas: prévia selecionável (pagas, abertas, vencidas, valores, juros, multa, desconto); avulsos ficam de fora; uma transação (`conta_azul_importar_financeiro`). Cliente sem lançamentos na Conta Azul: nada é criado lá. |
| Pagamento CA → Sra Luck | `/alteracoes` (cursor) → parcela vinculada → releitura → `conta_azul_registrar_baixa`: ledger com principal, juros, multa, desconto, total, data, IDs da baixa e do evento, origem `conta_azul`; chave `conta_azul:baixa:<id>` (nunca duplica). Fecha parcela em aberto, **em conferência** (preserva o comprovante) ou com comprovante rejeitado. É sincronização normal, não divergência. |
| Revisão | Paga só no Sra Luck (fecha sozinha quando a Conta Azul confirmar); baixa que não corresponde com segurança (valor, soma das baixas, parcela suspensa); cancelada/renegociada/perdida/parcial/excluída na Conta Azul; baixa removida lá. |
| Admin | Parcela vinculada: sem "Registrar pagamento" nem "Confirmar comprovante" (a API também recusa: `PAGAMENTO_CONTA_AZUL`). Ações: Pagamento controlado pela Conta Azul, Sincronizar agora, Ver vínculo, Ver detalhes, Ver comprovante. |
| Comprovantes | Ficam no Sra Luck (a API não tem upload de anexo). Cliente envia → Financeiro analisa → baixa feita na Conta Azul → sincronização. Receber comprovante nunca marca parcela como paga. |
| Ambientes | Production: desligada até `CONTA_AZUL_PRODUCAO_PERMITIDA=1`. Preview: só com `CONTA_AZUL_PREVIEW_PERMITIDO=1` (banco de teste). Sem a `migration_124`, o bloco da cliente some e o Financeiro segue igual. |

### Para ligar
1. Aplicar `migration_091` (depois da 090).
2. No cofre (Admin → Integrações): Client ID, Client Secret e, se preciso, Redirect URI da Conta Azul; conectar.
3. No Vault do Supabase: `sra_luck_app_url` e `sra_luck_cron_secret` (= `CRON_SECRET`).
4. Conta Azul: aplicar a `migration_124`, definir `CONTA_AZUL_PRODUCAO_PERMITIDA=1` (só com autorização), conectar e ligar a leitura automática; configurar funil/etapas do CRM e ligar a importação automática.
