# Rollback — migration_064_agenda_v46_regras_definitivas.sql

Este documento existe para o caso de a migration 064 precisar ser desfeita
depois de aplicada. **Não existe script de rollback automático destrutivo.**
O banco tem clientes reais; qualquer reversão aqui é manual, deliberada, e
prioriza nunca apagar dado real.

## O que a migration 064 realmente muda

### Colunas adicionadas (todas nullable ou com default seguro)

Em `public.agendamentos`:

| Coluna | Tipo | Default |
|---|---|---|
| `termos_responsavel` | text | null |
| `agenda_cirurgica_liberada_manualmente` | boolean | `false` |
| `agenda_cirurgica_liberada_por` | text | null |
| `agenda_cirurgica_prazo_ajuste_dias` | integer | `0` |
| `pagamento_cirurgia_confirmado_em` | timestamptz | null |
| `pagamento_cirurgia_confirmado_por` | text | null |
| `processo_concluido_em` | timestamptz | null |

Mais uma constraint (`agendamentos_prazo_ajuste_check`, `CHECK (agenda_cirurgica_prazo_ajuste_dias >= 0)`) e um índice (`idx_agendamentos_processo_concluido`).

Em `public.clientes`:

| Coluna | Tipo | Default |
|---|---|---|
| `liberacao_financeira_solicitada_em` | timestamptz | null |

Mais um índice (`idx_clientes_liberacao_financeira_solicitada`). Esta é a
**única fonte de verdade** de "a cliente solicitou a liberação financeira"
(Etapa 1 → 2). Deliberadamente **não** reaproveita `status_revisao_
financeira`/`financeiro_confirmado_em` — são conceitos diferentes (o
julgamento do admin sobre o levantamento, não o clique da cliente), e podem
mudar por outros caminhos (ex.: reenvio automático após "recusada" em
`worker/client-boletos.ts`), o que quebraria a garantia de "atingir o
percentual não move sozinha para Levantamentos" se fossem a mesma coluna.

### Funções substituídas (`CREATE OR REPLACE`)

Estas já existiam (migrations 060/061, aplicadas via `feat/cliente-detail-drawer`, não commitadas em `main`). A 064 troca o **corpo**, não a assinatura:

1. **`pode_agendar(uuid)`** — antes: `porcentagem_pagamento >= 70` fixo (via `percentual_minimo_fluxo_agenda()`). Depois: `porcentagem_pagamento >= coalesce(clientes.percentual_minimo_agendar, tiered fallback)`.
2. **`agenda_confirmar_previsao(uuid, date, text)`** — mesma lógica, com `pg_advisory_xact_lock` adicionado antes de somar `agenda_comprometimento_mes`.
3. **`agenda_tentar_liberar_cirurgia(uuid, text)`** — antes: liberava imediatamente quando previsão+comparecimento+quitação confirmados. Depois: exige adicionalmente 5 dias úteis (via `calcular_prazo_cirurgico_v46`) desde `greatest(comparecimento_em, quitacao_em)`.
4. **`agenda_reservar_cirurgia(uuid, date, text, text)`** — mesma lógica, com checagem de teto de R$ 100.000 (`pg_advisory_xact_lock` + `agenda_comprometimento_mes`) adicionada antes de gravar `data_cirurgia` — a versão anterior não tinha nenhuma proteção de teto neste ponto.

### Funções novas (não existiam antes)

`cliente_solicitar_liberacao_financeira`, `calcular_prazo_cirurgico_v46`, `agenda_cirurgica_ajustar_prazo`, `agenda_cirurgica_liberar_manual`, `agenda_definir_responsavel_termos`, `agenda_liberar_termos_para_nova_escolha`, `agenda_reagendar_termos_agora`, `agenda_confirmar_pagamento_cirurgia`.

### O que a 064 NÃO toca

Nenhuma tabela é criada, dropada ou truncada. Nenhuma linha é apagada ou
alterada em massa (o único `UPDATE` de dados é dentro de funções, disparado
por ação explícita de um usuário — não roda na migration em si).
`agenda_registrar_comparecimento`, `agenda_registrar_quitacao`,
`agenda_confirmar_levantamento`, `agendar_data`, `agenda_comprometimento_mes`,
`agenda_liberada` — todas de migration_060/061 — permanecem exatamente como
estavam.

## Se for preciso reverter

### 1. Reverter as 4 funções substituídas

Não existe "undo" automático — restaure a definição anterior com
`CREATE OR REPLACE FUNCTION`, usando exatamente o corpo abaixo (copiado das
migrations 060/061 reais, lidas por inteiro antes desta migration ser
escrita).

**`pode_agendar` (versão migration_061, 70% fixo):**

```sql
create or replace function public.pode_agendar(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists(select 1 from public.clientes c where c.id = p_cliente_id)
    and exists(select 1 from public.boletos b where b.cliente_id = p_cliente_id)
    and public.porcentagem_pagamento(p_cliente_id) >= public.percentual_minimo_fluxo_agenda();
$$;
```

**`agenda_tentar_liberar_cirurgia` (versão migration_060, liberação imediata):**

```sql
create or replace function public.agenda_tentar_liberar_cirurgia(
  p_agendamento_id uuid,
  p_usuario text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
  v_liberou boolean := false;
begin
  select * into v
  from public.agendamentos
  where id = p_agendamento_id
  for update;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  if v.previsao_cirurgia_confirmada_em is not null
    and v.comparecimento_status = 'compareceu'
    and v.quitacao_status = 'paga'
    and v.status in ('confirmado','realizado') then

    v_liberou := v.agenda_cirurgica_liberada_em is null;

    update public.agendamentos
    set agenda_cirurgica_liberada_em = coalesce(agenda_cirurgica_liberada_em,now()),
        updated_at = now()
    where id = p_agendamento_id;

    if v_liberou then
      insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
      values (
        p_usuario,'liberou_agenda_cirurgica','agendamentos',p_agendamento_id,
        jsonb_build_object('cliente_id',v.cliente_id,'previsao_cirurgia',v.previsao_cirurgia)
      );
    end if;
  end if;

  return v_liberou;
end;
$$;
```

**`agenda_confirmar_previsao` / `agenda_reservar_cirurgia`:** reverter é
remover só o bloco `perform pg_advisory_xact_lock(...)` (+ a checagem de
teto no caso de `agenda_reservar_cirurgia`) e manter o resto idêntico — o
diff está documentado nos comentários dentro de
`migration_064_agenda_v46_regras_definitivas.sql` (seções 5 e 12). Não é
recomendado reverter estas duas: elas só *adicionam* uma proteção que
faltava, não mudam nenhum comportamento existente para clientes que já
passaram por elas.

### 2. Colunas adicionadas — normalmente NÃO precisam ser removidas

As 8 colunas novas (7 em `agendamentos` + `clientes.liberacao_financeira_
solicitada_em`) são aditivas, nullable (exceto as duas com default
`false`/`0`, que são inertes até alguma função nova escrever nelas). Reverter
as 4 funções acima já faz o sistema parar de lê-las/escrevê-las via as RPCs
antigas — mas note que `liberacao_financeira_solicitada_em` só é lida/
gravada pela função NOVA `cliente_solicitar_liberacao_financeira` (não há
versão antiga dela para reverter; reverter = simplesmente parar de chamá-la,
via rollback do deploy do worker). Só remova as colunas se houver certeza
absoluta de que nada mais no código (worker/frontend) ainda as referencia —
e mesmo assim, prefira manter até uma limpeza posterior deliberada, porque:

- `DROP COLUMN` é destrutivo e perde qualquer dado já gravado nelas (ex.:
  `processo_concluido_em` de uma cirurgia já paga);
- não há nenhum conflito de nome ou de tipo com o restante do schema.

Se ainda assim for necessário remover (por exemplo, decisão de abandonar de
vez a V46 e reverter para migration_060 puro):

```sql
-- Só rodar depois de confirmar que nenhum código em produção lê/escreve
-- estas colunas, e só se realmente não houver dado relevante nelas:
alter table public.agendamentos drop constraint if exists agendamentos_prazo_ajuste_check;
drop index if exists idx_agendamentos_processo_concluido;
-- DROP COLUMN é irreversível — confirmar count(*) where coluna is not null
-- antes de cada linha abaixo, e não rodar nenhuma se o resultado for > 0.
-- alter table public.agendamentos drop column if exists termos_responsavel;
-- alter table public.agendamentos drop column if exists agenda_cirurgica_liberada_manualmente;
-- alter table public.agendamentos drop column if exists agenda_cirurgica_liberada_por;
-- alter table public.agendamentos drop column if exists agenda_cirurgica_prazo_ajuste_dias;
-- alter table public.agendamentos drop column if exists pagamento_cirurgia_confirmado_em;
-- alter table public.agendamentos drop column if exists pagamento_cirurgia_confirmado_por;
-- alter table public.agendamentos drop column if exists processo_concluido_em;
drop index if exists idx_clientes_liberacao_financeira_solicitada;
-- alter table public.clientes drop column if exists liberacao_financeira_solicitada_em;
```

As linhas de `DROP COLUMN` estão deliberadamente comentadas. Não descomentar
sem confirmar manualmente, coluna por coluna, que está vazia em todas as
linhas (`select count(*) from agendamentos where <coluna> is not null`).

### 3. Funções novas — seguro remover, mas prefira deixar inertes

As 8 funções novas só são chamadas pelo `worker/admin-agenda-central.ts` e
pelo `worker/client-agenda.ts` novos. Se o código da aplicação for revertido
junto (deploy do worker anterior), essas funções simplesmente não são mais
chamadas por ninguém — não precisam ser dropadas. Se quiser removê-las por
limpeza:

```sql
drop function if exists public.cliente_solicitar_liberacao_financeira(uuid);
drop function if exists public.calcular_prazo_cirurgico_v46(timestamptz, timestamptz, integer);
drop function if exists public.agenda_cirurgica_ajustar_prazo(uuid, integer, text);
drop function if exists public.agenda_cirurgica_liberar_manual(uuid, text);
drop function if exists public.agenda_definir_responsavel_termos(uuid, text, text);
drop function if exists public.agenda_liberar_termos_para_nova_escolha(uuid, text);
drop function if exists public.agenda_reagendar_termos_agora(uuid, uuid, text, text);
drop function if exists public.agenda_confirmar_pagamento_cirurgia(uuid, text);
```

Nenhum `DROP FUNCTION` acima afeta dados — só remove código.

## Preservação de dados entre migration e rollback

Qualquer ação real feita pelas clientes/admin **entre** a aplicação da 064 e
um eventual rollback (ex.: uma cirurgia paga com `pagamento_cirurgia_
confirmado_em` preenchido, um `termos_responsavel` definido, um prazo
ajustado com `agenda_cirurgica_prazo_ajuste_dias`) fica **gravada nas
colunas novas**. Reverter as funções não apaga esses dados — eles só param
de ser lidos pela lógica antiga. Por isso o passo 2 acima trata `DROP
COLUMN` como último recurso, nunca automático.

## Ordem recomendada se um rollback for necessário

1. Reverter o deploy do worker/frontend para a versão anterior (para de
   chamar as funções novas).
2. `CREATE OR REPLACE` de `pode_agendar` e `agenda_tentar_liberar_cirurgia`
   com os corpos documentados acima.
3. Deixar as colunas novas e as 8 funções novas como estão (inertes).
4. Só considerar `DROP COLUMN`/`DROP FUNCTION` numa limpeza deliberada
   posterior, com os `count(*)` de segurança do passo 2 já confirmados.
