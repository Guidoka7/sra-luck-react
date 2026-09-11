# Rollback e Disaster Recovery — Sra. Luck

## Objetivo

Preservar clientes, contratos, pagamentos, comprovantes, pontos, comissões e trilhas de auditoria mesmo quando um deploy ou migration precisar ser revertido.

## Regra principal

Código e banco são tratados separadamente. As migrations finais são aditivas sempre que possível. Um rollback de frontend/Worker não implica automaticamente rollback de banco.

## Antes de deploy de produção

1. Confirmar que `npm run check` está verde no commit exato do deploy.
2. Confirmar backup recente do PostgreSQL/Supabase.
3. Confirmar que Storage crítico está incluído na política de backup/exportação.
4. Registrar o SHA do commit atualmente em produção.
5. Executar `supabase/migrations.sql` com `ON_ERROR_STOP=1`.
6. Executar `supabase/seed.sql`.
7. Validar `/api/health`, login de cliente, login administrativo e leitura do painel.
8. Só então ativar providers `live` que já tenham homologação.

## Backup PostgreSQL

Exemplo com `pg_dump` usando conexão direta ou pooler compatível:

```bash
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="sra-luck-$(date +%Y%m%d-%H%M).dump"
```

Tabelas de prioridade máxima:

```text
clientes
contratos_credito
boletos
comprovantes_pagamento
conciliacao_financeira_eventos
agenda_reservas_credito
cliente_pontos
cliente_pontos_eventos
indicacoes_clientes
clube_resgates
colaboradores
comissao_regras
comissao_eventos
audit_log
integracao_eventos
webhook_queue
```

O backup deve ficar em armazenamento criptografado, com acesso restrito e política de retenção compatível com LGPD e regras internas da empresa. Não armazenar dumps no GitHub.

## Teste de restauração

Backup sem teste de restauração não é considerado validado. Em ambiente isolado:

```bash
createdb sra_luck_restore_test
pg_restore --clean --if-exists --no-owner --dbname=sra_luck_restore_test arquivo.dump
```

Validar contagens, constraints, funções e relações principais antes de marcar o backup como restaurável.

## Rollback de código

Se frontend ou Worker apresentar regressão depois do deploy:

1. identificar o último SHA verde;
2. reverter o commit problemático ou redeployar o último SHA verde;
3. não executar `supabase/rollback.sql` se a migration for compatível com o código anterior;
4. validar `/api/health`, autenticação e fluxo principal;
5. manter `INTEGRATION_MODE=mock` ou desabilitar providers externos se a falha estiver em integração;
6. documentar o incidente em `audit_log`/sistema interno.

O pipeline só faz deploy de `main` depois de lint, testes e build.

## Rollback de banco

`supabase/rollback.sql` remove somente infraestrutura adicionada pelo hardening final que pode ser retirada sem excluir dados de negócio. Ele preserva `audit_log` deliberadamente.

Antes de executar:

```bash
pg_dump "$SUPABASE_DB_URL" --format=custom --file=pre-rollback.dump
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollback.sql
```

Não executar rollback destrutivo de clientes, contratos, boletos, pagamentos, pontos ou comissões para corrigir erro de aplicação. Para esses casos, restaure em ambiente paralelo e faça reconciliação controlada.

## Falha de webhook

Eventos externos entram primeiro em `webhook_queue`. Se processamento falhar:

- o evento permanece persistido;
- `attempts` aumenta;
- `next_attempt_at` aplica backoff;
- após o limite, o status vira `falhou`;
- `last_error` guarda o motivo sem credenciais.

Recuperação operacional: corrigir a causa, recolocar o registro como `pendente`, zerar `locked_at` e definir `next_attempt_at=now()` somente depois de confirmar que o evento é idempotente.

## Falha de provider externo

1. manter a operação interna disponível quando possível;
2. não marcar parcela como paga sem confirmação válida;
3. registrar falha estruturada;
4. manter evento na fila;
5. respeitar `Retry-After` e backoff;
6. se necessário, alternar `INTEGRATION_MODE=mock` somente em ambiente não produtivo. Em produção, desabilitar o provider afetado pela configuração/feature operacional, nunca simular pagamento real.

## Comprometimento de credencial

1. revogar imediatamente a credencial no provedor;
2. rotacionar secret no Cloudflare/Supabase;
3. não fazer commit da nova credencial;
4. invalidar sessões se `CLIENTE_SESSION_SECRET` tiver sido exposto;
5. revisar logs de auditoria e acessos;
6. rotacionar tokens de webhook afetados;
7. documentar período de exposição e impacto.

## Perda ou corrupção de dados

1. congelar escrita no módulo afetado;
2. preservar banco atual para análise;
3. restaurar último backup validado em ambiente paralelo;
4. comparar eventos/auditoria desde o backup;
5. reaplicar eventos idempotentes de `integracao_eventos`/`webhook_queue` quando apropriado;
6. reconciliar pagamentos antes de liberar novamente escrita financeira;
7. promover base restaurada somente após validação funcional e financeira.

## RPO e RTO

Definir formalmente com a diretoria conforme volume e criticidade. Recomendação operacional para dados financeiros ativos:

- backup automático diário no mínimo;
- retenção de múltiplas versões;
- teste periódico de restauração;
- export adicional antes de migrations relevantes;
- monitoramento de erro/latência em tempo real pelo Cloudflare e tabelas internas.

## Evidências após incidente

Preservar:

```text
audit_log
api_request_metrics
integracao_eventos
webhook_queue
conciliacao_financeira_eventos
logs estruturados do Cloudflare
SHA do deploy
horário de início/fim do incidente
```

Nunca apagar `audit_log` como parte de uma correção normal.
