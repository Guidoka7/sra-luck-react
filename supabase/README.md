# Supabase — dados e migrations

O Supabase é parte ativa da regra de negócio: PostgreSQL, RPCs, constraints, RLS, Storage e Realtime.

## Regra principal

Antes de alterar uma regra financeira, agenda, parcela, autenticação ou permissão, pesquisar se já existe:

- coluna relacionada;
- RPC/função SQL;
- trigger;
- constraint;
- índice;
- policy RLS;
- migration histórica.

Não implementar no Worker uma regra contraditória sem tratar a regra existente no banco.

## Histórico de migrations

O repositório herdou migrations do PWA e possui numerações repetidas em partes do histórico.

Não renomear migrations antigas apenas para organizar. Elas podem ter sido executadas em ambientes existentes.

Para migrations novas:

- usar nome/ordem inequívocos;
- documentar intenção;
- preferir operações idempotentes quando apropriado;
- não destruir dados silenciosamente;
- separar backfill de alteração estrutural quando reduzir risco;
- fornecer rollback/plano de reversão para alterações críticas;
- validar em desenvolvimento antes de produção.

## Campos históricos importantes

O modelo herdado contém conceitos como:

- `valor_contrato` — historicamente valor base/carta/crédito;
- `taxa_administrativa_percentual`;
- `custo_total`;
- `quantidade_parcelas`;
- boletos/parcelas;
- revisão financeira;
- datas/agendamentos;
- configurações;
- notificações.

Não mudar o significado de coluna histórica sem migration explícita, backfill e compatibilidade.

## Regra de percentual

A elegibilidade operacional é baseada em quantidade de parcelas pagas sobre total de parcelas.

Não substituir por soma financeira.

## Concorrência

Agenda e pagamentos exigem atenção especial.

Usar banco/RPC/transação/constraint quando necessário para impedir:

- dupla ocupação de vaga;
- baixa duplicada;
- geração duplicada de comissão;
- resgate duplicado;
- webhook duplicado gerando efeito novamente.

## RLS e privilégios

- Browser usa somente credenciais públicas.
- Service role pertence exclusivamente ao backend.
- RLS deve refletir a fronteira real de acesso.
- Esconder botão no frontend não é autorização.

## Auditoria

Mudanças críticas devem registrar, quando aplicável:

- entidade;
- identificador;
- ação;
- ator/sistema;
- timestamp;
- request/event id;
- dados mínimos necessários para rastreio.

Evitar armazenar segredo ou dado sensível sem necessidade.

## Documentação relacionada

- `/AGENTS.md`
- `/docs/BUSINESS-RULES.md`
- `/docs/MIGRATION-MAP.md`
- `/docs/ARCHITECTURE.md`
