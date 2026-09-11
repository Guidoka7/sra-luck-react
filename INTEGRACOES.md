# Integrações — Sra. Luck

Este documento descreve o contrato interno dos providers. O sistema roda sem serviços externos com `INTEGRATION_MODE=mock`; a mudança para `live` é feita por variáveis/secrets, sem alterar o fluxo de domínio.

## Princípios

1. Credenciais existem somente no Cloudflare Worker.
2. React nunca chama banco, RD Station, Mercado Pago ou Conta Azul diretamente.
3. Cada integração implementa uma interface interna estável.
4. Adapters convertem respostas externas para o modelo Sra. Luck.
5. Toda chamada externa usa timeout, retry com exponential backoff e logging estruturado.
6. Webhooks são autenticados, enfileirados, idempotentes e processados fora da requisição do provedor.
7. `INTEGRATION_MODE=mock` é o modo seguro para desenvolvimento e CI.

## Factory

`worker/providers/factory.ts` expõe:

```text
ProviderFactory.bank("brb" | "bb" | "santander" | "sicredi" | "efi")
ProviderFactory.rd()
ProviderFactory.payment("mercado_pago" | "conta_azul")
```

Interfaces:

- `BancoProvider`: `createCharge`, `getCharge`, `verifyWebhook`, `normalizeWebhook`.
- `RDProvider`: `upsertLead`, `verifyWebhook`, `normalizeWebhook`.
- `PagamentoProvider`: `createPayment`, `getPayment`, `verifyWebhook`, `normalizeWebhook`.

O formato interno está em `worker/providers/types.ts`.

## BancoProvider

O adapter bancário é configurável por instituição. As cinco instituições usam a mesma interface interna e podem ter URL, autenticação, paths e nomes de campos independentes.

Prefixos:

```text
BANCO_BRB_*
BANCO_BB_*
BANCO_SANTANDER_*
BANCO_SICREDI_*
BANCO_EFI_*
```

Variáveis principais de cada banco:

```text
*_API_KEY=
*_BASE_URL=
*_AUTH_MODE=api_key|bearer|oauth2_client_credentials
*_API_KEY_HEADER=x-api-key
*_TOKEN_URL=
*_CLIENT_ID=
*_CLIENT_SECRET=
*_SCOPE=
*_CREATE_CHARGE_PATH=/charges
*_GET_CHARGE_PATH=/charges/{id}
*_WEBHOOK_TOKEN=
*_FIELD_ID=id
*_FIELD_STATUS=status
*_FIELD_BARCODE=barcode
*_FIELD_DIGITABLE_LINE=digitable_line
*_FIELD_PAYMENT_URL=payment_url
```

Em OAuth2 client credentials, tokens ficam em memória do isolate apenas até pouco antes do vencimento. Se o isolate reiniciar, o token é obtido novamente.

### Formato interno de cobrança

Entrada:

```json
{
  "reference": "boleto:<uuid>",
  "amount": 1200.50,
  "dueDate": "2026-12-10",
  "description": "Parcela Sra. Luck",
  "customer": {
    "name": "Nome da cliente",
    "document": "CPF somente dígitos",
    "email": "cliente@exemplo.com",
    "phone": "..."
  }
}
```

Saída normalizada:

```json
{
  "provider": "brb",
  "externalId": "...",
  "status": "created",
  "amount": 1200.50,
  "dueDate": "2026-12-10",
  "barcode": "...",
  "digitableLine": "...",
  "paymentUrl": "..."
}
```

O contrato exato do payload externo de cada instituição deve ser homologado com a documentação/conta contratada da instituição antes de `INTEGRATION_MODE=live`. O domínio e as rotas internas não mudam; somente os parâmetros de adapter definidos em ambiente devem refletir o contrato homologado quando ele for configurável. Se um banco exigir assinatura criptográfica ou certificado mútuo específico não representável por headers/OAuth2 padrão, isso deve ser disponibilizado como secret/binding do provider, preservando a interface interna.

## RD Station

Variáveis:

```text
RD_STATION_API_KEY=
RD_STATION_WEBHOOK_TOKEN=
RD_STATION_BASE_URL=https://api.rd.services
RD_STATION_UPSERT_PATH=/platform/contacts
```

O provider valida nome, CPF quando presente, e-mail e valor antes da rede. Eventos recebidos são normalizados como `lead_created`, `lead_updated` ou `deal_won`.

Endpoint de webhook:

```text
POST /api/webhooks/rd_station
```

Token aceito nos headers configurados pelo provider, preferencialmente `x-rd-webhook-token`.

## Mercado Pago

Variáveis:

```text
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_TOKEN=
MERCADO_PAGO_BASE_URL=https://api.mercadopago.com
```

O app da cliente cria checkout por:

```text
POST /api/cliente/payments/mercado-pago/preference
```

A parcela é buscada no banco usando a sessão da cliente. Valor e titular não são aceitos do navegador como fonte de verdade.

Webhook:

```text
POST /api/webhooks/mercado_pago
```

Quando `x-signature` + `x-request-id` estão presentes, o provider valida HMAC. O evento vai para a fila e somente depois é conciliado.

## Conta Azul

Variáveis:

```text
CONTA_AZUL_API_KEY=
CONTA_AZUL_WEBHOOK_TOKEN=
CONTA_AZUL_BASE_URL=
CONTA_AZUL_CREATE_RECEIVABLE_PATH=
CONTA_AZUL_GET_RECEIVABLE_PATH=
```

O provider representa contas a receber pela interface `PagamentoProvider`, porque o domínio interno precisa criar/consultar recebíveis e processar baixas sem acoplar telas ao ERP.

Webhook:

```text
POST /api/webhooks/conta_azul
```

## Webhook queue

Fluxo:

```text
Provedor
   |
   | assinatura/token
   v
/api/webhooks/:provider
   |
   | UPSERT(provider,event_id)
   v
webhook_queue
   |
   | cron a cada 1 minuto
   | FOR UPDATE SKIP LOCKED
   v
Provider.normalizeWebhook()
   |
   +--> integracao_eventos
   +--> boletos
   +--> conciliacao_financeira_eventos
```

Estados da fila:

```text
pendente -> processando -> processado
                    |
                    +-> pendente (retry/backoff)
                    +-> falhou (após limite de tentativas)
```

A chave única `(provider,event_id)` impede processamento duplicado do mesmo evento recebido mais de uma vez.

## Eventos normalizados

Tipos internos:

```text
charge_created
charge_updated
payment_pending
payment_settled
payment_failed
lead_created
lead_updated
deal_won
unknown
```

Formato:

```json
{
  "provider": "mercado_pago",
  "eventId": "evento externo",
  "type": "payment_settled",
  "resourceId": "pagamento externo",
  "reference": "boleto:<uuid>",
  "amount": 1200.50,
  "occurredAt": "2026-09-11T12:00:00Z",
  "status": "approved"
}
```

## Retry e timeout

`worker/middleware/retry.ts` aplica:

- timeout explícito por chamada;
- exponential backoff + jitter;
- respeito a `Retry-After`;
- retry para 408, 425, 429, 500, 502, 503 e 504;
- métodos não idempotentes só são repetidos quando têm `x-idempotency-key`.

Providers de criação enviam chave de idempotência baseada na referência interna.

## Logs

Cada chamada externa registra JSON estruturado com:

```text
timestamp
level
requestId
provider
operation
method
durationMs
status
attempt
```

Campos cujo nome sugere senha, token, secret, cookie, CPF ou API key são redigidos pelo logger.

## Mock providers

Com `INTEGRATION_MODE=mock`, a factory retorna providers determinísticos que não acessam a internet. A suíte em `tests/providers` e `tests/integration` cobre sucesso, erro, timeout, validação e normalização de webhook.

## Checklist para ativar um provider real

1. Manter `INTEGRATION_MODE=mock` durante configuração.
2. Preencher secrets no ambiente do Worker.
3. Preencher URL/path/mapeamento de campos conforme homologação.
4. Confirmar endpoint de webhook e token/assinatura no portal do provedor.
5. Rodar `npm run check`.
6. Validar em ambiente de homologação do provedor.
7. Alterar `INTEGRATION_MODE=live` no ambiente de homologação.
8. Conferir `integracao_eventos`, `webhook_queue`, `audit_log` e `api_request_metrics`.
9. Somente depois replicar secrets/configuração para produção.
