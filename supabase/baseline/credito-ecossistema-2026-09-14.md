# Snapshot de baseline — tabelas fora do histórico de migrations

**Data da captura:** 2026-09-14, via inspeção read-only do projeto Supabase `sbohknqapprimtspczio`
(information_schema, pg_constraint, pg_indexes, pg_policies, pg_trigger, pg_enum).

**Isto é documentação, NÃO um script executável.** Não rodar este arquivo contra nenhum banco.
Ele registra fielmente o estado real hoje das 9 tabelas abaixo, que existem no banco conectado
mas não têm migration correspondente commitada em `supabase/*.sql`. A origem foi confirmada pelo
responsável do projeto como intencional (criadas via dashboard/SQL diretamente para o
`sra-luck-react`, sem o arquivo de migration ter sido gerado na hora).

Este snapshot é o insumo para uma futura migration idempotente (Fase 1), que só deve ser redigida
e testada contra um banco **vazio** de desenvolvimento antes de qualquer aplicação — nunca
assumir que `CREATE TABLE IF NOT EXISTS` sozinho prova equivalência com o que já está em produção.

Tabelas cobertas: `novas_vendas`, `carnes`, `importacoes_boletos`, `comissoes`,
`metas_colaboradores`, `notificacoes_colaboradores`, `mensagens_motivacionais`,
`conciliacao_pagamentos`, `conciliacao_pagamentos_historico`.

## Tipos ENUM usados por essas tabelas

| Enum | Valores (ordem) |
|---|---|
| `status_nova_venda` | `aguardando_cadastro`, `aguardando_boletos`, `financeiro_concluido` |
| `status_carne` | `ativo`, `concluido` |
| `status_importacao_boleto` | `processando`, `aguardando_vinculacao`, `aguardando_confirmacao`, `vinculado`, `erro` |
| `status_conciliacao_pagamento` | `pendente`, `conciliado`, `nao_identificado`, `divergencia`, `ignorado` |
| `metodo_conciliacao_pagamento` | `boleto`, `pix`, `outro` |
| `cargo_colaborador` | `vendedora`, `sdr`, `financeiro`, `administrativo` |

`cargo_colaborador` já era usado por `colaboradores`/`comissao_regras` (migration_030, aplicada);
`comissoes.cargo` e `mensagens_motivacionais.cargo` reaproveitam esse mesmo enum, não criam um novo.

---

## `novas_vendas`

Staging de entrada comercial (RD Station) — modela exatamente o fluxo de `BUSINESS-RULES.md` §5.

**Colunas:**
| Coluna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | não | `gen_random_uuid()` |
| rd_station_id | text | não | — |
| cliente_id | uuid | sim | — |
| nome_completo | text | não | — |
| cpf | text | sim | — |
| telefone | text | sim | — |
| email | text | sim | — |
| data_venda | timestamptz | não | `now()` |
| vendedora_responsavel | text | sim | — |
| valor_contrato | numeric | não | `0` |
| quantidade_parcelas | integer | sim | — |
| valor_parcela | numeric | sim | — |
| taxa_administrativa | numeric | sim | — |
| tipo_venda | text | sim | — |
| origem_venda | text | sim | — |
| status | status_nova_venda | não | `'aguardando_cadastro'` |
| payload_original | jsonb | sim | — |
| created_at / updated_at | timestamptz | não | `now()` |
| vendedora_id | uuid | sim | — |

**PK:** `id`. **FK:** `cliente_id → clientes.id`, `vendedora_id → colaboradores.id`.
**UNIQUE:** `rd_station_id` (impede duplicidade de webhook/importação do mesmo negócio).
**CHECK:** `quantidade_parcelas is null or quantidade_parcelas > 0`; `valor_contrato >= 0`.
**Índices:** `status`, `data_venda desc`, `cliente_id`, `cpf`, `vendedora_id` (+ PK e UNIQUE).
**Trigger:** `trg_novas_vendas_updated_at` (BEFORE UPDATE → `set_updated_at()`).
**RLS:** habilitado. Policy `admin_full_access_novas_vendas` (ALL, `auth.role() = 'authenticated'`).

---

## `carnes`

Carnê emitido por instituição financeira, associado a um cliente.

**Colunas:** `id uuid pk`, `cliente_id uuid not null`, `instituicao_financeira text not null`,
`identificador_externo text not null`, `data_geracao date not null`, `quantidade_parcelas integer not null`,
`valor_parcela numeric not null`, `valor_total numeric not null`, `status status_carne not null default 'ativo'`,
`created_at`/`updated_at timestamptz not null default now()`.

**PK:** `id`. **FK:** `cliente_id → clientes.id`.
**CHECK:** `quantidade_parcelas > 0`; `valor_parcela >= 0`; `valor_total >= 0`;
`length(trim(instituicao_financeira)) > 0`; `length(trim(identificador_externo)) > 0`.
**UNIQUE:** `uniq_carne_instituicao_identificador` em `(lower(trim(instituicao_financeira)), lower(trim(identificador_externo)))`
— impede carnê duplicado da mesma instituição.
**Índices:** `cliente_id`, `lower(trim(instituicao_financeira))`, `data_geracao desc`, `status` (+ PK/UNIQUE).
**Trigger:** `trg_carnes_updated_at`.
**RLS:** habilitado. Policy `admin_full_access_carnes` (ALL, `authenticated`).

---

## `importacoes_boletos`

Staging de importação de boletos/carnê em PDF, com extração e pontuação de confiança — é a base
de dados já pronta para o fluxo "importar carnê em 3 etapas" do ZIP visual.

**Colunas principais:** `id`, `cliente_id`, `carne_id`, `boleto_id`, `instituicao_financeira`,
`nosso_numero`, `numero_documento`, `identificador_externo`, `linha_digitavel`, `codigo_barras`,
`nome_pagador_extraido`, `cpf_pagador_extraido`, `valor_extraido numeric`, `vencimento_extraido date`,
`numero_parcela integer`, `dados_extraidos jsonb not null default '{}'`, `arquivo_nome`, `arquivo_mime`,
`arquivo_tamanho bigint`, `arquivo_sha256`, `arquivo_storage_path`, `historico jsonb not null default '[]'`,
`status status_importacao_boleto not null default 'processando'`, `erro_detalhes text`,
`created_at`/`updated_at`, `cliente_sugerido_id`, `carne_sugerido_id`, `boleto_sugerido_id`,
`cliente_vinculado_id`, `carne_vinculado_id`, `boleto_vinculado_id`, `pontuacao_confianca integer`,
`nivel_confianca text`, `status_vinculacao text not null default 'pendente'`,
`analise_detalhada jsonb not null default '{}'`.

**PK:** `id`. **FK:** `cliente_id/cliente_sugerido_id/cliente_vinculado_id → clientes.id`;
`carne_id/carne_sugerido_id/carne_vinculado_id → carnes.id`; `boleto_id/boleto_sugerido_id/boleto_vinculado_id → boletos.id`.
**CHECK:** `nivel_confianca is null or nivel_confianca in ('alta','media','baixa')`;
`status_vinculacao in ('pendente','analisado','aguardando_confirmacao','vinculado','ignorado')`.
**UNIQUE:**
- `uniq_importacao_boleto_arquivo_sha256` em `arquivo_sha256` (quando presente) — **impede reprocessar o mesmo arquivo PDF duas vezes**;
- `uniq_importacao_boleto_instituicao_nosso` em `(instituicao, nosso_numero)` (quando ambos presentes);
- `uniq_importacao_boleto_instituicao_externo` em `(instituicao, identificador_externo)` (quando ambos presentes).
**Índices:** `nivel_confianca`, `cliente_sugerido_id`, `boleto_sugerido_id`, `cliente_id`, `carne_id`,
`boleto_id`, `status`, `created_at desc`, `lower(trim(instituicao_financeira))`, `status_vinculacao`.
**Trigger:** `trg_importacoes_boletos_updated_at`.
**RLS:** habilitado. Policy `admin_full_access_importacoes_boletos` (ALL, `authenticated`).

---

## `comissoes`

Comissão por evento, já com chave de idempotência — mais completa que `comissao_eventos` (migration_030).

**Colunas:** `id`, `colaborador_id uuid not null`, `cargo cargo_colaborador not null`, `cliente_id uuid`,
`agendamento_id uuid`, `boleto_id uuid`, `evento text not null`, `chave_evento text not null`,
`valor numeric not null`, `status text not null default 'pendente'`, `gerado_por uuid`,
`pago_em timestamptz`, `created_at`/`updated_at`.

**PK:** `id`. **FK:** `colaborador_id → colaboradores.id`, `cliente_id → clientes.id`,
`agendamento_id → agendamentos.id`, `boleto_id → boletos.id` (`gerado_por` sem FK declarada).
**UNIQUE:** `chave_evento` — **é a chave de idempotência** que impede gerar a mesma comissão duas vezes.
**CHECK:** `evento in ('primeira_parcela_confirmada','comparecimento','manual_configuracao_financeiro')`;
`valor >= 0`; `status in ('pendente','aprovada','paga')`.
**Índices:** `(colaborador_id, created_at desc)`, `(cliente_id, evento)` (+ PK/UNIQUE).
**Trigger:** `trg_comissoes_updated_at`.
**RLS:** habilitado. Policy `colaborador_self_comissoes` (SELECT, só o próprio colaborador via `auth.uid()` ↔ `colaboradores.auth_user_id`). **Não há policy de escrita** — inserção/atualização hoje só é possível via `service_role` (Worker), o que é o esperado (nenhum código ainda escreve aqui).

---

## `metas_colaboradores`

Meta mensal de comissão por colaborador.

**Colunas:** `id`, `colaborador_id uuid not null`, `ano integer not null`, `mes integer not null`,
`meta_minima numeric not null default 0`, `percentual_comissao numeric`, `comissao_estimada numeric`,
`comissao_final numeric`, `created_at`/`updated_at`.

**PK:** `id`. **FK:** `colaborador_id → colaboradores.id`.
**UNIQUE composta:** `(colaborador_id, ano, mes)` — uma meta por colaborador/mês.
**CHECK:** `mes between 1 and 12`.
**Trigger:** `trg_metas_colaboradores_updated_at`.
**RLS:** habilitado. Policy `colaborador_self_meta` (SELECT, só o próprio colaborador). Sem policy de escrita (só `service_role`).

---

## `notificacoes_colaboradores`

Notificações internas por colaborador.

**Colunas:** `id`, `colaborador_id uuid not null`, `tipo text not null`, `titulo text not null`,
`mensagem text not null`, `data_referencia date`, `lida boolean not null default false`, `created_at`.

**PK:** `id`. **FK:** `colaborador_id → colaboradores.id`.
**UNIQUE:** `uniq_resumo_colaborador_dia` em `(colaborador_id, tipo, data_referencia)` quando `data_referencia` não é nulo — evita notificação duplicada do mesmo tipo no mesmo dia.
**Índices:** `(colaborador_id, created_at desc)`.
**RLS:** habilitado. Policies `colaborador_self_notificacoes` (SELECT) e `colaborador_self_notificacoes_update` (UPDATE) — só o próprio colaborador, sem `updated_at`/trigger (tabela não tem essa coluna).

---

## `mensagens_motivacionais`

Mensagens motivacionais programadas por cargo.

**Colunas:** `id`, `cargo cargo_colaborador`, `titulo text not null`, `mensagem text not null`,
`programada_para timestamptz`, `ativo boolean not null default true`, `created_by uuid`, `created_at`/`updated_at`.

**PK:** `id`. **FK:** nenhuma declarada para `created_by` (sem referência a `colaboradores`).
**Trigger:** `trg_mensagens_motivacionais_updated_at`.
**RLS:** habilitado, mas **sem nenhuma policy** — hoje, com RLS ativo e zero policies, a tabela é inacessível a `anon`/`authenticated` via API pública; só `service_role` (Worker) consegue ler/escrever. Não é um erro de segurança, mas vale decidir na Fase de colaboradores se precisa de uma policy de leitura por cargo.

---

## `conciliacao_pagamentos`

Conciliação bancária — mesmo conceito da aba "Conciliação" (placeholder) do Financeiro Unificado.

**Colunas:** `id`, `banco text not null`, `identificador_externo text`, `cliente_id uuid`, `boleto_id uuid`,
`data_pagamento date not null`, `valor_recebido numeric not null`, `metodo_pagamento metodo_conciliacao_pagamento not null`,
`status status_conciliacao_pagamento not null default 'pendente'`, `dados_origem jsonb`, `observacao text`,
`motivo_divergencia text`, `created_at`/`updated_at`.

**PK:** `id`. **FK:** `cliente_id → clientes.id`, `boleto_id → boletos.id`.
**UNIQUE:** `uniq_conciliacao_banco_identificador` em `(lower(trim(banco)), identificador_externo)` quando o identificador existe e não é vazio.
**CHECK:** `valor_recebido >= 0`; `length(trim(banco)) > 0`;
`status <> 'divergencia' or motivo_divergencia preenchido`; `status <> 'ignorado' or observacao/motivo_divergencia preenchido`.
**Índices:** `data_pagamento desc`, `status`, `lower(trim(banco))`, `cliente_id`, `boleto_id`.
**Trigger:** `trg_conciliacao_pagamentos_updated_at`.
**RLS:** habilitado. Policy `admin_full_access_conciliacao_pagamentos` (ALL, `authenticated`).

---

## `conciliacao_pagamentos_historico`

Histórico de mudança de status de uma conciliação.

**Colunas:** `id`, `conciliacao_pagamento_id uuid not null`, `usuario text not null`, `created_at`,
`status_anterior status_conciliacao_pagamento`, `status_novo status_conciliacao_pagamento not null`,
`cliente_id uuid`, `boleto_id uuid`, `observacao text`, `motivo_divergencia text`.

**PK:** `id`. **FK:** `conciliacao_pagamento_id → conciliacao_pagamentos.id`, `cliente_id → clientes.id`, `boleto_id → boletos.id`.
**Índices:** `(conciliacao_pagamento_id, created_at desc)`, `created_at desc`.
**RLS:** habilitado. Policies `admin_select_conciliacao_historico` (SELECT) e `admin_insert_conciliacao_historico` (INSERT), ambas `authenticated`. Sem policy de UPDATE/DELETE — histórico é append-only por desenho, o que é o comportamento correto para uma trilha de auditoria.

---

## Observação geral de qualidade

Todas as 9 tabelas têm: PK própria, FK reais para as entidades corretas, pelo menos uma
constraint de unicidade pensada para evitar duplicidade operacional (arquivo reprocessado, carnê
duplicado, comissão duplicada, notificação duplicada no mesmo dia), índices compatíveis com os
filtros que o ZIP visual pede, e RLS habilitado com policies coerentes com o padrão já usado no
resto do banco (`admin_full_access_*` para operação administrativa, `colaborador_self_*` para
autoatendimento do colaborador). **Nenhuma dessas tabelas precisa de redesenho** — a única exceção
observada é `mensagens_motivacionais`, que tem RLS habilitado sem nenhuma policy (fica acessível
somente via `service_role`), a decidir quando o domínio de colaboradores for retomado.
