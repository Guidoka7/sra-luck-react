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

### 096–110: leituras consolidadas (aplicadas em 26/09/2026)

As migrations `096` a `106` e `108` a `110` foram aplicadas no Supabase principal a partir do branch `load-test-10k-isolated` e agora estão versionadas aqui sem alteração. Em 28/09/2026 o SQL de cada arquivo foi comparado com `supabase_migrations.schema_migrations` (sem comentários e linhas em branco): idêntico nas 14.

- São funções somente de leitura (`loadtest_*` e os aliases de produção `admin_*`, `finance_*`, `*_snapshot`, sem `SECURITY DEFINER` e sem `EXECUTE` para `anon`/`authenticated`) e o endurecimento de `EXECUTE` das funções `notificar_*` (110).
- A `107_loadtest_finance_received_page` **não** foi aplicada nem versionada: a `108` redefine a mesma função (`loadtest_finance_received_page`). Não criar arquivo 107.
- A `111` (liberação automática com status `realizado`) está pronta com teste e rollback, **ainda não aplicada**.

### 112: levantamento atômico (não aplicada em produção)

`migration_112_levantamento_atomico.sql` cria `agenda_registrar_levantamento`: decisão do levantamento, responsável e auditoria na mesma transação. Teste: `supabase/tests/levantamento_atomico_112.sql` (inclui falha forçada da auditoria). Rollback: `supabase/rollback/migration_112_rollback.sql`.

**Ordem obrigatória:** aplicar a 112 antes de promover o App que chama a RPC; sem ela, "Concluir levantamento" responde erro (e nada é gravado).

### 113: fila de pendências de integração (não aplicada em produção)

`migration_113_integracao_pendencias.sql` cria `integracao_pendencias` (uma linha aberta por negociação + tipo, com ocorrências), `colaborador_vinculos_externos` (responsável do RD ↔ vendedora/SDR por ID estável), as RPCs `integracao_registrar_pendencia`, `integracao_resolver_pendencias`, `rd_recalcular_pendencias_venda` (regra única do que é venda completa) e `rd_recalcular_pendencias_todas` (preenche a fila a partir das vendas existentes, sem reimportar), e a view `vw_vendas_validas_bi`. Tudo só para `service_role`. Rollback: `supabase/rollback/migration_113_rollback.sql` (remove só esses objetos; vendas e importações ficam). Diagnóstico e motivo: `docs/DIAGNOSTICO-RD-2026-09-28.md`.

**Ordem obrigatória:** aplicar a 113 antes de promover o App que grava pendências; sem ela, a importação termina em erro `PENDENCIA_NAO_REGISTRADA` (visível no histórico) em vez de gravar em silêncio. Depois de aplicada, rodar `select public.rd_recalcular_pendencias_todas('dev:<ator>')` **só com aprovação**: ela não altera vendas além de preencher `vendedora_id` pelos vínculos cadastrados.

### 115: catálogo pré-calculado do RD Station (não aplicada em produção)

`migration_115_integracao_catalogos.sql` cria `integracao_catalogos` (provedor + chave → `dados` jsonb, `atualizado_em`, `duracao_ms`, último `erro`). O Worker guarda ali os funis, etapas, campos por funil, valores selecionáveis (responsável, fonte, campanha, campos de opção) e sugestões de origem (`worker/crm-catalogo.ts`); a configuração do RD no Dev Console lê essa linha na hora em vez de esperar o RD. Só metadados do CRM, nenhum dado pessoal de cliente. Só `service_role`. Rollback: `supabase/rollback/migration_115_rollback.sql`.

Opcional para o App funcionar: sem ela o catálogo fica em memória de cada instância (a primeira abertura após um deploy lê o RD, alguns segundos).

### 116: vínculo do responsável do RD com a equipe opcional (não aplicada em produção)

`migration_116_rd_vinculo_equipe_opcional.sql` redefine `rd_recalcular_pendencias_venda` para não abrir mais `vendedora_nao_vinculada` (o vínculo, quando existe, continua preenchendo `vendedora_id`), tira a exigência de `vendedora_id` de `vw_vendas_validas_bi` e encerra como descartadas as pendências `vendedora_nao_vinculada` abertas. Decisão do responsável em 29/09/2026. Comissão continua exigindo a vendedora da cliente. Pré-requisito: 113. Rollback: `supabase/rollback/migration_116_rollback.sql` (as pendências reabrem no próximo recálculo).

### 117: agendador de integrações autorizado pelo cofre

`migration_117_integracoes_cron_autorizado.sql` cria `integracoes_cron_autorizado(token)`: o App confirma o Bearer do pg_cron (`integracoes_disparar_sync`) contra `vault.sra_luck_cron_secret` sem que o segredo saia do banco. Em 29/09/2026 o cron recebia 402 (URL de deploy desativado, corrigida no cofre para `sraluckapp.vercel.app`) e depois 401 (CRON_SECRET diferente). Só `service_role`. Rollback: `supabase/rollback/migration_117_rollback.sql`.

### 118: continuação da importação do CRM em etapas

`migration_118_crm_importacao_continuacao.sql` cria `integracoes_disparar_continuacao_crm()` e o job `integracoes-crm-continuacao` (minutos 5, 10, 20, 25, 35, 40, 50 e 55), que chama `/api/cron/integracoes/crm` com o mesmo segredo do cofre. O App importa o RD em etapas (100 negociações por página, posição guardada em `integracao_catalogos`/`crm_importacao_progresso`); este job só continua uma passada que não terminou. Em 29/09/2026 todas as execuções com "todos os funis" eram encerradas no meio. Pré-requisitos: 091, 115, 117. Rollback: `supabase/rollback/migration_118_rollback.sql`.

### 119: imagens das recompensas do Clube no próprio app

`migration_119_clube_recompensas_imagens.sql` cria o bucket privado `clube-recompensas` (JPG/PNG/WebP, 5 MB) e a coluna `clube_recompensas.imagem_path`. O Admin envia a imagem e ela é servida por `/api/clube/recompensas/{id}/imagem` (endereço permanente). Em 25/09/2026 a imagem da "Nécessaire premium" era uma miniatura temporária do Dropbox e quebrou no app. Rollback: `supabase/rollback/migration_119_rollback.sql`.

### 120: rotinas diárias pelo pg_cron

`migration_120_rotinas_diarias_pg_cron.sql` cria `rotinas_disparar(rotina)` e os jobs `notificacoes-financeiras-diaria` (11:05 UTC) e `mensagem-do-dia-diaria` (03:05 UTC), que chamam o App com o segredo do cofre. Os crons da Vercel pararam em 23–24/09/2026 (sem mensagem do dia nem lembrete automático de parcela). Pré-requisito: 117. Rollback: `supabase/rollback/migration_120_rollback.sql`.

### 121: entidade_id do log como texto

`migration_121_logs_entidade_id_texto.sql` troca `logs_alteracoes.entidade_id` de uuid para texto. O App grava o identificador das integrações ("rd_station", "web_push", "gemini"…) e o banco recusava em silêncio: nenhum teste de conexão, importação do RD, OAuth ou chave VAPID ficava no histórico ("conexão nunca verificada" no Dev Console). Rollback: `supabase/rollback/migration_121_rollback.sql`.

### 122: espelho somente-leitura do RD

`migration_122_crm_espelho_rd.sql` cria `crm_rd_negociacoes` e `crm_rd_contatos`: cópia de todas as negociações (os 15 funis) e contatos do RD, regravada pela varredura de 6 h, com a fonte/campanha resolvida de cada negociação. Alimenta a cobertura de origem por funil no Console; não cria vendas nem clientes (a importação continua só com os funis marcados). RLS ligado, sem políticas. Rollback: `supabase/rollback/migration_122_rollback.sql`.

### 123: contato completo no espelho

`migration_123_crm_espelho_contato_dados.sql` adiciona `crm_rd_contatos.dados` (o contato no formato do cache da venda). A importação usa o espelho em vez de consultar o RD uma vez por cliente nova: com todos os funis marcados, a passada levava horas. Rollback: `supabase/rollback/migration_123_rollback.sql`.

### 124: Conta Azul — parcela única com dois IDs

`migration_124_conta_azul_parcela_unica.sql` cria `cliente_vinculos_externos` (cliente ↔ pessoa da Conta Azul, confirmado pela equipe a partir do CPF; um vínculo ativo por cliente e por pessoa), acrescenta a `conta_azul_vinculos` a origem do vínculo, as divergências aceitas na confirmação e quem confirmou, e cria duas RPCs: `conta_azul_registrar_baixa` (baixa vinda da Conta Azul entra no ledger `financeiro_recebimentos` com principal, juros, multa e desconto, com trava e idempotência iguais às da baixa manual) e `conta_azul_importar_financeiro` (monta, numa transação, o financeiro de uma cliente que ainda não tem nenhuma parcela a partir dos lançamentos da Conta Azul). Não altera parcelas existentes. Rollback: `supabase/rollback/migration_124_rollback.sql`.

- A `114` continua reservada ao modelo de lotes/conciliação do Console (`docs/INTEGRACOES-CONSOLE-CONCILIACAO.md`); a `124` implementa a parte de vínculos daquele desenho (`cliente_vinculos_externos`, `origem_vinculo`, `confirmado_por`). A próxima livre é a `125`.

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
