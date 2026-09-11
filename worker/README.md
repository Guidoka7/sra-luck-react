# Cloudflare Worker — organização do backend

`worker/` é o backend oficial do `sra-luck-react`.

## Objetivo

Evoluir gradualmente do conjunto atual de handlers na raiz para uma arquitetura por responsabilidade, sem quebrar o runtime existente.

## Estrutura alvo

```text
worker/
  index.ts
  routes/
    client/
    admin/
    webhooks/
  domain/
    contracts/
    installments/
    finance/
    scheduling/
    journey/
    commissions/
    rewards/
  providers/
    rd-station/
    conta-azul/
    mercado-pago/
    banks/
  auth/
  validation/
  observability/
  shared/
```

## Responsabilidades

### `index.ts`

Deve tender a ficar responsável por:

- receber Request;
- resolver rota;
- aplicar middleware comum;
- encaminhar para handler;
- tratamento de erro de fronteira.

Evitar colocar regra de negócio complexa diretamente nele.

### `routes/`

Responsável por HTTP:

- parâmetros;
- autenticação/autorização da rota;
- validação de request;
- chamada do serviço/domínio;
- montagem de response.

### `domain/`

Responsável pela regra de negócio reutilizável.

Exemplo: cálculo de elegibilidade, transição da jornada, baixa de parcela, comissão.

Uma regra crítica deve existir em uma autoridade clara, não em múltiplos handlers.

### `providers/`

Responsável por serviços externos.

A aplicação trabalha com contratos internos normalizados e o provider traduz para cada fornecedor.

### `auth/`

Sessões, cookies, papéis e autorização.

### `validation/`

Schemas/validação compartilhada do backend.

### `observability/`

Logs estruturados, métricas, tracing/eventos e integração de erro.

## Regras financeiras

- Nenhuma baixa pode ser duplicada por retry/webhook repetido.
- Operações não idempotentes devem usar proteção apropriada.
- Webhooks precisam validar autenticidade quando possível.
- Registrar identificadores externos.
- Nunca logar token/segredo.
- Auditoria deve guardar contexto suficiente para rastrear alteração crítica.

## Regra de migração

Os arquivos atuais como `admin-finance.ts`, `admin-parcelas.ts`, `client-boletos.ts`, `client-agenda.ts`, `journey.ts` etc. não devem ser movidos em massa.

Quando um domínio for trabalhado:

1. mapear rotas atuais;
2. identificar regras duplicadas;
3. extrair regra para domínio quando fizer sentido;
4. manter compatibilidade de rota;
5. testar;
6. só então remover implementação antiga.

## Fonte funcional

Sempre consultar:

- `/AGENTS.md`;
- `/docs/BUSINESS-RULES.md`;
- `/docs/FLOWS.md`;
- `/docs/PWA-FUNCTIONAL-BASELINE.md`;
- `/docs/AI-CODEMAP.md`.