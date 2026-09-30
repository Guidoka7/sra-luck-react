-- 124 — Conta Azul: a parcela como um compromisso único com dois IDs.
--
-- Três níveis de vínculo (IDs externos persistidos, nunca só nome ou posição):
--   Pessoa:     clientes.id ↔ pessoa da Conta Azul       → cliente_vinculos_externos (nova, genérica por provedor)
--   Financeiro: as parcelas da cliente ↔ lançamentos dela → conjunto de conta_azul_vinculos
--   Parcela:    boletos.id ↔ parcela da Conta Azul        → conta_azul_vinculos (migration_091)
--
-- Reaproveita a estrutura da migration_091 (vínculos, fila, conflitos, travas, cursores) e o
-- ledger financeiro_recebimentos (migration_033, que já aceita origem 'conta_azul').
--
-- Novo:
--   cliente_vinculos_externos: vínculo confirmado pela equipe, pelo CPF. Um ativo por cliente e por
--     pessoa (desenho de docs/INTEGRACOES-CONSOLE-CONCILIACAO.md §5).
--   conta_azul_vinculos: como o vínculo nasceu e as divergências aceitas na confirmação
--     (ex.: vencimento diferente). Nada é alterado para "fazer bater".
--   conta_azul_registrar_baixa: baixa vinda da Conta Azul entra no ledger com a composição
--     (principal, juros, multa, desconto) e a mesma trava/idempotência da baixa manual.
--   conta_azul_importar_financeiro: monta o financeiro de uma cliente SEM parcelas a partir dos
--     lançamentos da Conta Azul, numa única transação (nada pela metade, nada duplicado).
--
-- Não destrutiva. Não altera boletos existentes, regras de elegibilidade, cálculo da jornada,
-- fluxo de comprovantes nem pagamentos históricos.
-- Rollback: supabase/rollback/migration_124_rollback.sql

-- ---------------------------------------------------------------------------
-- Pessoa
-- ---------------------------------------------------------------------------
create table if not exists public.cliente_vinculos_externos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null check (provedor in ('conta_azul')),
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  id_externo text not null,
  documento text not null check (documento ~ '^[0-9]{11}$'),
  nome_externo text,
  estado text not null default 'vinculado' check (estado in ('vinculado', 'desvinculado')),
  snapshot jsonb not null default '{}'::jsonb,
  confirmado_por text not null,
  confirmado_em timestamptz not null default now(),
  desvinculado_por text,
  desvinculado_em timestamptz,
  motivo_desvinculo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Um vínculo ativo por cliente e por pessoa externa, em cada provedor.
create unique index if not exists cliente_vinculos_externos_cliente_ativo_uniq
  on public.cliente_vinculos_externos(provedor, cliente_id) where estado = 'vinculado';
create unique index if not exists cliente_vinculos_externos_externo_ativo_uniq
  on public.cliente_vinculos_externos(provedor, id_externo) where estado = 'vinculado';
create index if not exists cliente_vinculos_externos_documento_idx on public.cliente_vinculos_externos(provedor, documento);

alter table public.cliente_vinculos_externos enable row level security;
revoke all on public.cliente_vinculos_externos from public, anon, authenticated;
grant all on public.cliente_vinculos_externos to service_role;

-- ---------------------------------------------------------------------------
-- Parcela: como o vínculo nasceu e o que foi aceito na confirmação
-- ---------------------------------------------------------------------------
alter table public.conta_azul_vinculos add column if not exists origem_vinculo text
  check (origem_vinculo is null or origem_vinculo in ('criado_pela_sra', 'confirmado_manual', 'importado_da_conta_azul'));
alter table public.conta_azul_vinculos add column if not exists divergencias_aceitas jsonb not null default '[]'::jsonb;
alter table public.conta_azul_vinculos add column if not exists confirmado_por text;
alter table public.conta_azul_vinculos add column if not exists confirmado_em timestamptz;
create index if not exists conta_azul_vinculos_cliente_idx on public.conta_azul_vinculos(cliente_id);

-- ---------------------------------------------------------------------------
-- Baixa vinda da Conta Azul → ledger (mesmas garantias da financeiro_baixar_boleto)
-- ---------------------------------------------------------------------------
create or replace function public.conta_azul_registrar_baixa(
  p_boleto_id uuid,
  p_data_pagamento date,
  p_juros numeric,
  p_multa numeric,
  p_desconto numeric,
  p_forma_pagamento text,
  p_ca_baixa_id text,
  p_usuario text,
  p_idempotency_key text
)
returns public.financeiro_recebimentos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_boleto public.boletos%rowtype;
  v_recebimento public.financeiro_recebimentos%rowtype;
  v_juros numeric(12,2) := round(coalesce(p_juros, 0), 2);
  v_multa numeric(12,2) := round(coalesce(p_multa, 0), 2);
  v_desconto numeric(12,2) := round(coalesce(p_desconto, 0), 2);
  v_total numeric(12,2);
begin
  if p_data_pagamento is null then raise exception 'Data do pagamento obrigatoria'; end if;
  if nullif(btrim(p_ca_baixa_id), '') is null then raise exception 'Baixa da Conta Azul sem identificador'; end if;
  if p_forma_pagamento not in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'outro') then
    raise exception 'Forma de pagamento invalida';
  end if;
  if v_juros < 0 or v_multa < 0 or v_desconto < 0 then raise exception 'Composicao financeira invalida'; end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  -- Depois da trava: repetição (fila, leitura dupla de /alteracoes) devolve o mesmo lançamento.
  select * into v_recebimento from public.financeiro_recebimentos where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  -- 'pendente_confirmacao' fica de fora: há comprovante da cliente aguardando conferência,
  -- e o fluxo de comprovantes não é alterado (vira conflito para a equipe).
  if v_boleto.status::text not in ('nao_pago', 'rejeitado') then raise exception 'Parcela nao esta em aberto'; end if;

  v_total := round(v_boleto.valor + v_juros + v_multa - v_desconto, 2);
  if v_total < 0 then raise exception 'Desconto superior ao valor devido'; end if;

  insert into public.financeiro_recebimentos (
    boleto_id, cliente_id, valor_original, juros, multa, desconto, valor_recebido,
    data_pagamento, forma_pagamento, origem, status_validacao, comprovante_url,
    external_payment_id, external_reference, observacao, idempotency_key, criado_por, validado_por, validado_em
  ) values (
    v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_juros, v_multa, v_desconto, v_total,
    p_data_pagamento, p_forma_pagamento, 'conta_azul', 'validado', v_boleto.comprovante_url,
    p_ca_baixa_id, 'conta_azul:baixa', 'Baixa registrada na Conta Azul.', p_idempotency_key, p_usuario, p_usuario, now()
  ) returning * into v_recebimento;

  update public.boletos set status = 'pago', data_pagamento = p_data_pagamento where id = v_boleto.id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'baixa_vinda_da_conta_azul', 'boletos', v_boleto.id,
    jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id, 'ca_baixa_id', p_ca_baixa_id,
      'valor_original', v_boleto.valor, 'juros', v_juros, 'multa', v_multa, 'desconto', v_desconto,
      'valor_recebido', v_total, 'forma_pagamento', p_forma_pagamento));

  return v_recebimento;
end;
$$;
revoke all on function public.conta_azul_registrar_baixa(uuid, date, numeric, numeric, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_azul_registrar_baixa(uuid, date, numeric, numeric, numeric, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Financeiro que nasce da Conta Azul (cliente sem nenhuma parcela)
-- p_parcelas: [{ caParcelaId, caEventoId, caVersao, valor, vencimento, ca (snapshot),
--               pago, dataPagamento, juros, multa, desconto, forma, caBaixaId }]
-- ---------------------------------------------------------------------------
create or replace function public.conta_azul_importar_financeiro(
  p_cliente_id uuid,
  p_ca_pessoa_id text,
  p_parcelas jsonb,
  p_usuario text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total integer;
  v_pagas integer := 0;
  v_item jsonb;
  v_ordem bigint;
  v_boleto_id uuid;
  v_valor numeric(12,2);
  v_venc date;
  v_pago boolean;
  v_data_pag date;
  v_juros numeric(12,2);
  v_multa numeric(12,2);
  v_desconto numeric(12,2);
  v_forma text;
begin
  perform 1 from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'Cliente nao encontrada'; end if;
  perform 1 from public.cliente_vinculos_externos where provedor = 'conta_azul' and cliente_id = p_cliente_id and id_externo = p_ca_pessoa_id and estado = 'vinculado';
  if not found then raise exception 'Cliente sem vinculo confirmado com a pessoa da Conta Azul'; end if;
  -- Nunca duplica: só monta o financeiro de quem ainda não tem nenhuma parcela.
  perform 1 from public.boletos where cliente_id = p_cliente_id limit 1;
  if found then raise exception 'Cliente ja possui financeiro'; end if;

  if jsonb_typeof(p_parcelas) <> 'array' then raise exception 'Parcelas invalidas'; end if;
  v_total := jsonb_array_length(p_parcelas);
  if v_total < 1 or v_total > 240 then raise exception 'Quantidade de parcelas invalida'; end if;

  for v_item, v_ordem in
    select e, row_number() over (order by (e->>'vencimento')::date, e->>'caParcelaId')
    from jsonb_array_elements(p_parcelas) as e
  loop
    v_valor := round((v_item->>'valor')::numeric, 2);
    v_venc := (v_item->>'vencimento')::date;
    v_pago := coalesce((v_item->>'pago')::boolean, false);
    if v_valor is null or v_valor <= 0 then raise exception 'Valor de parcela invalido'; end if;
    if v_venc is null then raise exception 'Vencimento obrigatorio'; end if;
    if nullif(btrim(v_item->>'caParcelaId'), '') is null then raise exception 'Parcela da Conta Azul sem identificador'; end if;

    insert into public.boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status)
    values (p_cliente_id, v_ordem, v_total, v_valor, v_venc, 'nao_pago')
    returning id into v_boleto_id;

    v_data_pag := null;
    if v_pago then
      v_data_pag := (v_item->>'dataPagamento')::date;
      v_juros := round(coalesce((v_item->>'juros')::numeric, 0), 2);
      v_multa := round(coalesce((v_item->>'multa')::numeric, 0), 2);
      v_desconto := round(coalesce((v_item->>'desconto')::numeric, 0), 2);
      v_forma := coalesce(nullif(v_item->>'forma', ''), 'outro');
      if v_data_pag is null then raise exception 'Parcela paga sem data de pagamento'; end if;
      if nullif(btrim(v_item->>'caBaixaId'), '') is null then raise exception 'Parcela paga sem baixa identificada'; end if;
      insert into public.financeiro_recebimentos (
        boleto_id, cliente_id, valor_original, juros, multa, desconto, valor_recebido,
        data_pagamento, forma_pagamento, origem, status_validacao, external_payment_id, external_reference,
        observacao, idempotency_key, criado_por, validado_por, validado_em
      ) values (
        v_boleto_id, p_cliente_id, v_valor, v_juros, v_multa, v_desconto, round(v_valor + v_juros + v_multa - v_desconto, 2),
        v_data_pag, v_forma, 'conta_azul', 'validado', v_item->>'caBaixaId', 'conta_azul:importacao',
        'Recebimento importado da Conta Azul.', 'conta_azul:baixa:' || (v_item->>'caBaixaId'), p_usuario, p_usuario, now()
      );
      update public.boletos set status = 'pago', data_pagamento = v_data_pag where id = v_boleto_id;
      v_pagas := v_pagas + 1;
    end if;

    insert into public.conta_azul_vinculos (
      boleto_id, cliente_id, marcador, estado, ca_contato_id, ca_evento_id, ca_parcela_id, ca_versao,
      sra_snapshot, ca_snapshot, ca_baixa_id, baixa_origem, ultima_sincronizacao_em,
      origem_vinculo, confirmado_por, confirmado_em, criado_por
    ) values (
      v_boleto_id, p_cliente_id, 'SLK-' || upper(substr(replace(v_boleto_id::text, '-', ''), 1, 16)), 'vinculado',
      p_ca_pessoa_id, nullif(v_item->>'caEventoId', ''), v_item->>'caParcelaId', nullif(v_item->>'caVersao', '')::integer,
      jsonb_build_object('valor', v_valor, 'vencimento', v_venc, 'status', case when v_pago then 'pago' else 'nao_pago' end, 'dataPagamento', v_data_pag),
      coalesce(v_item->'ca', '{}'::jsonb), case when v_pago then v_item->>'caBaixaId' end, case when v_pago then 'conta_azul' end, now(),
      'importado_da_conta_azul', p_usuario, now(), p_usuario
    );
  end loop;

  update public.clientes set quantidade_parcelas = v_total where id = p_cliente_id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'importou_financeiro_conta_azul', 'clientes', p_cliente_id,
    jsonb_build_object('parcelas', v_total, 'pagas', v_pagas, 'ca_pessoa_id', p_ca_pessoa_id));

  return jsonb_build_object('parcelas', v_total, 'pagas', v_pagas);
end;
$$;
revoke all on function public.conta_azul_importar_financeiro(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.conta_azul_importar_financeiro(uuid, text, jsonb, text) to service_role;
