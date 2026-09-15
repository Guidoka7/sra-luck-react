# Observabilidade Sra. Luck

## Objetivo

Padronizar logs técnicos estruturados em JSON, correlação por `requestId`, níveis (`info`, `warn`, `error`, `fatal`) e sanitização rigorosa antes de qualquer evento sair da aplicação.

## Regras obrigatórias

- Nunca registrar senha, token, cookie, Authorization, CPF, data de nascimento, e-mail, telefone, endereço, chave PIX, dados de cartão, endpoint/chaves de Web Push ou payload bruto de provedor financeiro.
- Preferir allowlist de contexto (`requestId`, `action`, `actorType`, `actorId` pseudonimizado, `entityType`, `entityId`, `provider`, `statusCode`, `durationMs`, `eventCode`).
- `info`: operação normal relevante.
- `warn`: comportamento inesperado recuperável.
- `error`: operação falhou, mas o serviço continua operando.
- `fatal`: configuração/invariante crítica impede operação segura.
- Auditoria de negócio continua em `logs_alteracoes`; telemetria técnica usa o logger e `monitoramento_erros`.
- Integração futura com Datadog deve consumir os JSON logs do Worker; não enviar payloads brutos.
- Uptime Kuma deve monitorar `/api/health` e, quando disponível, `/api/ready` externamente.
