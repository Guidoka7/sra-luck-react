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

### Conta Azul — `worker/conta-azul.ts`

| Pedido | Como ficou |
|---|---|
| OAuth com renovação | Conectar no Admin; token renovado 2 min antes de vencer, com trava no banco (o refresh token é de uso único). `access_revoked`/`invalid_refresh_token` pedem reconexão. |
| Vínculo permanente | `conta_azul_vinculos`: parcela ↔ evento/parcela da Conta Azul, versão e últimos estados dos dois lados. Criação com marcador `SLK-…` na descrição e na nota; o vínculo só é confirmado ao achar exatamente um lançamento com o marcador. Também dá para vincular um lançamento existente (seguro só se valor e vencimento baterem). Parcela vinculada não pode ser excluída. |
| Sra Luck como fonte | Mudança de valor/vencimento no Sra Luck → `PATCH` com a versão atual. Mudança feita na Conta Azul → conflito. Juros e multa da baixa calculados pelo Sra Luck na data do pagamento. |
| Baixa CA → Sra Luck e app | Polling de `/alteracoes` a cada 15 min + conferência dos vínculos mais antigos. Aplicada sozinha só com vínculo seguro: vínculo confirmado, quitada por inteiro, mesmo valor bruto, parcela em aberto ou aguardando confirmação, não suspensa, baixa automática ligada. |
| Baixa/estorno Sra Luck → CA | `POST …/baixa` (confere antes se já existe baixa com o marcador) e `DELETE …/baixa/{id}` só para baixa que o Sra Luck criou. |
| Conflitos | `integracao_conflitos` (um aberto por parcela e tipo). Ações: reaplicar Sra Luck, dar baixa no Sra Luck, estornar no Sra Luck, manter, desvincular — todas auditadas; as que mexem no status da parcela exigem a permissão de baixa manual. |
| Fila e retentativa | `integracao_fila` com chave de idempotência, até 6 tentativas com espera exponencial; erro final visível e reprocessável. |
| Cancelamento, renegociação, ID externo, webhooks | A API não permite: cancelado/renegociado/perdido na Conta Azul vira conflito; sem ID externo (marcador); sem webhook (polling). |

Mutações financeiras da Conta Azul só por sessão humana do Admin; a guarda M2M do Dev Console
não libera nenhuma rota `conta-azul/*` nem a configuração `conta_azul.sincronizacao`.

### Para ligar
1. Aplicar `migration_091` (depois da 090).
2. No cofre (Admin → Integrações): Client ID, Client Secret e, se preciso, Redirect URI da Conta Azul; conectar.
3. No Vault do Supabase: `sra_luck_app_url` e `sra_luck_cron_secret` (= `CRON_SECRET`).
4. Escolher a conta financeira e ligar a sincronização; configurar funil/etapas do CRM e ligar a importação automática.
