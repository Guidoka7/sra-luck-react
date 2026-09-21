# QA — Etapa 1: Solicitação de liberação financeira

Casos A) e C) (thresholds exatos) já são cobertos por testes automatizados
reais: `worker/agenda-elegibilidade.test.ts` (16 testes, rodam em `npm test`,
sem precisar de banco — testam a tabela de elegibilidade pura, espelho do
`public.pode_agendar`).

Os casos abaixo (B, D–I) dependem de estado real no Postgres — persistência,
concorrência entre duas conexões, e o comportamento de `cliente_solicitar_
liberacao_financeira` (`security definer`, `for update`) sob carga
simultânea não são coisas que um teste unitário isolado consegue provar
honestamente. Ficam documentados aqui como roteiro **executável**, para
rodar depois que `migration_064_agenda_v46_regras_definitivas.sql` for
aplicada. Nenhum deles foi executado nesta sessão (sem escrita no Supabase).

Pré-requisito: um `cliente_id` de teste com boletos reais persistidos,
abaixo do mínimo, e outro exatamente no mínimo (ou ajustar um existente).

## B) Cliente abaixo do threshold chamando o endpoint diretamente

Sem passar pela UI — confirma que o backend não confia em nada vindo do
cliente, mesmo que a UI devesse ter escondido o botão.

```bash
curl -i -X POST https://<host>/api/cliente/agenda/solicitar-liberacao \
  -H "Cookie: cliente_session=<sessão de uma cliente abaixo do mínimo>"
```

**Esperado:** `409`, corpo `{"erro":"Você ainda não atingiu a quantidade
mínima de parcelas pagas para solicitar a liberação financeira."}`.
Confirmar no banco que `clientes.liberacao_financeira_solicitada_em`
continua `null` para essa cliente:

```sql
select liberacao_financeira_solicitada_em from clientes where id = '<id>';
-- esperado: null
```

## D) Cliente no threshold mas ainda sem clicar

```sql
select id, liberacao_financeira_solicitada_em from clientes where id = '<id-elegivel>';
-- esperado: liberacao_financeira_solicitada_em is null
```

```bash
curl -s https://<host>/api/admin/central/visao-geral -H "Cookie: admin_session=<...>" \
  | jq '.filas.preEligibility[] | select(.id=="<id-elegivel>")'
```

**Esperado:** a cliente aparece em `filas.preEligibility`, não em
`filas.financialReview`. No app (`GET /api/cliente/agenda` com a sessão
dela), `elegibilidade.elegivel = true` e `elegibilidade.
liberacaoFinanceiraSolicitada = false` — o botão "Solicitar liberação
financeira" deve estar visível e habilitado na tela (etapa `"elegivel"` em
`AgendaBloqueadaPercentual`).

## E) Cliente clica — timestamp persistido

```bash
curl -i -X POST https://<host>/api/cliente/agenda/solicitar-liberacao \
  -H "Cookie: cliente_session=<sessão da cliente elegível>"
```

**Esperado:** `200`, `{"ok":true,"liberacaoFinanceiraSolicitada":true,"liberacaoFinanceiraSolicitadaEm":"<timestamp>","jaSolicitado":false}`.

```sql
select liberacao_financeira_solicitada_em, updated_at from clientes where id = '<id-elegivel>';
-- esperado: liberacao_financeira_solicitada_em preenchido, próximo de agora

select usuario, acao, detalhes from logs_alteracoes
where entidade = 'clientes' and entidade_id = '<id-elegivel>'
  and acao = 'solicitou_liberacao_financeira_etapa1'
order by created_at desc limit 5;
-- esperado: exatamente 1 linha
```

## F) Novo GET/refetch

```bash
curl -s https://<host>/api/cliente/agenda -H "Cookie: cliente_session=<...>" | jq '.elegibilidade'
```

**Esperado:** `{"elegivel":true,"liberacaoFinanceiraSolicitada":true,"liberacaoFinanceiraSolicitadaEm":"<mesmo timestamp de E>"}`.

## G) Admin refaz GET da Central

```bash
curl -s https://<host>/api/admin/central/visao-geral -H "Cookie: admin_session=<...>" \
  | jq '.filas.financialReview[] | select(.id=="<id-elegivel>"), .filas.preEligibility[] | select(.id=="<id-elegivel>")'
```

**Esperado:** a cliente agora aparece em `filas.financialReview` e **não**
mais em `filas.preEligibility`.

## H) Dois cliques simultâneos

```bash
# duas requisições disparadas ao mesmo tempo (mesma cliente, ainda não solicitou)
curl -s -X POST https://<host>/api/cliente/agenda/solicitar-liberacao -H "Cookie: cliente_session=<...>" &
curl -s -X POST https://<host>/api/cliente/agenda/solicitar-liberacao -H "Cookie: cliente_session=<...>" &
wait
```

**Esperado:** as duas respondem `200` (a RPC é idempotente — a segunda só
não grava nada), mas:

```sql
select count(*) from logs_alteracoes
where entidade = 'clientes' and entidade_id = '<id-elegivel>'
  and acao = 'solicitou_liberacao_financeira_etapa1';
-- esperado: exatamente 1 (não 2)

select liberacao_financeira_solicitada_em from clientes where id = '<id-elegivel>';
-- esperado: um único timestamp, não alterado entre as duas chamadas
```

Isso é garantido pelo `select ... for update` no início de
`cliente_solicitar_liberacao_financeira`: a segunda transação bloqueia até a
primeira commitar, então vê a coluna já preenchida e pula o `if`.

## I) Refresh completo do navegador

Repetir o GET de F) numa aba nova/depois de F5. **Esperado:** mesmo
resultado — `liberacaoFinanceiraSolicitada: true` sempre, porque a fonte é
a coluna persistida, nunca estado de componente React.

## Checklist de aceite

- [ ] B retorna 409, não grava nada
- [ ] D mostra `preEligibility` + botão habilitado, sem grants automáticos
- [ ] E persiste timestamp + 1 log de auditoria
- [ ] F reflete o timestamp real via refetch (não `setState` local)
- [ ] G move a cliente para `financialReview` na Central
- [ ] H produz exatamente 1 log e 1 timestamp sob concorrência
- [ ] I sobrevive a refresh completo do navegador
