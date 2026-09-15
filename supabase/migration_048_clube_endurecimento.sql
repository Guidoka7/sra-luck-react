-- ============================================================================
-- MIGRATION 048: Endurecimento do Clube de Vantagens (resgate atômico +
-- benefício da 1ª parcela)
--
-- Contexto: o backend do Clube de Vantagens (migration_022) existe
-- (clube_recompensas, cliente_pontos, cliente_pontos_eventos,
-- indicacoes_clientes, clube_resgates) mas nunca foi exposto na experiência
-- real da cliente e tinha duas lacunas: (1) o resgate de pontos não era
-- atômico (race condition possível em cliques concorrentes) e (2) não havia
-- como conceder benefícios que não custam pontos (voucher da 1ª parcela).
--
-- Escopo desta migration: só o necessário para o app da cliente funcionar
-- corretamente (resgate seguro + bônus automático da 1ª parcela + extrato
-- de indicações). A administração do Clube (confirmar indicação, aprovar
-- resgate, ajuste manual, config de pontos) fica para quando o módulo
-- administrativo tiver especificação própria — não criamos aqui rotas nem
-- funções que só fariam sentido com essa tela.
--
-- Esta migration é ADITIVA: não remove nem renomeia nada existente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Catálogo de prêmios: ordenação e ícone (exibição client-side).
-- ----------------------------------------------------------------------------
alter table clube_recompensas
  add column if not exists ordem integer not null default 0,
  add column if not exists icone_key text,
  add column if not exists instrucoes_pos_resgate text;

-- ----------------------------------------------------------------------------
-- 2. Resgates: chave de idempotência para o débito atômico (mesmo padrão de
--    financeiro_recebimentos.idempotency_key, migration_033).
-- ----------------------------------------------------------------------------
alter table clube_resgates
  add column if not exists idempotency_key text;

create unique index if not exists idx_clube_resgates_idempotency_key
  on clube_resgates(idempotency_key) where idempotency_key is not null;

-- ----------------------------------------------------------------------------
-- 3. Benefícios não pontuáveis da cliente (voucher de consulta liberado pela
--    confirmação da 1ª parcela). Ledger de pontos continua em
--    cliente_pontos_eventos; esta tabela é para benefícios de uso único que
--    não circulam como saldo.
-- ----------------------------------------------------------------------------
create table if not exists clube_beneficios_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  beneficio_key text not null,
  status text not null default 'disponivel' check (status in ('disponivel','utilizado','cancelado')),
  origem text not null,
  referencia_id uuid,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, beneficio_key, origem)
);

create index if not exists idx_clube_beneficios_cliente_cliente_id on clube_beneficios_cliente(cliente_id);

alter table clube_beneficios_cliente enable row level security;
create policy "admin_full_access_clube_beneficios_cliente" on clube_beneficios_cliente
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- 4. Configuração do Clube (singleton) — só o bônus da 1ª parcela por
--    enquanto (pontos por indicação continua sem fluxo de confirmação até o
--    módulo admin existir, então não criamos config para algo ainda sem uso).
-- ----------------------------------------------------------------------------
create table if not exists clube_config (
  id integer primary key default 1 check (id = 1),
  pontos_primeira_parcela integer not null default 50,
  voucher_primeira_parcela_ativo boolean not null default true,
  voucher_primeira_parcela_titulo text not null default 'Voucher de Consulta com o Doutor',
  updated_at timestamptz not null default now()
);
insert into clube_config (id) values (1) on conflict (id) do nothing;

alter table clube_config enable row level security;
create policy "admin_full_access_clube_config" on clube_config
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- 5. Bônus idempotente da 1ª parcela — chamado de dentro das transações que
--    confirmam uma parcela como paga (financeiro_baixar_boleto e
--    financeiro_validar_comprovante, redefinidas abaixo). Idempotência via
--    a constraint unique(cliente_id, beneficio_key, origem) acima: só
--    concede pontos/voucher quando o INSERT do benefício realmente ocorre
--    pela primeira vez.
-- ----------------------------------------------------------------------------
create or replace function public.clube_conceder_bonus_primeira_parcela(
  p_cliente_id uuid,
  p_boleto_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config public.clube_config%rowtype;
  v_beneficio_id uuid;
begin
  select * into v_config from public.clube_config where id = 1;
  if not found or not v_config.voucher_primeira_parcela_ativo then
    return;
  end if;

  insert into public.clube_beneficios_cliente (cliente_id, beneficio_key, origem, referencia_id)
  values (p_cliente_id, 'voucher_consulta_doutor', 'primeira_parcela', p_boleto_id)
  on conflict (cliente_id, beneficio_key, origem) do nothing
  returning id into v_beneficio_id;

  if v_beneficio_id is null then
    -- Benefício já concedido anteriormente (reprocessamento) — não duplica.
    return;
  end if;

  if v_config.pontos_primeira_parcela > 0 then
    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (p_cliente_id, 'bonus', v_config.pontos_primeira_parcela, p_boleto_id::text, jsonb_build_object('motivo', 'primeira_parcela'));

    insert into public.cliente_pontos (cliente_id, saldo, updated_at)
    values (p_cliente_id, v_config.pontos_primeira_parcela, now())
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo,
          updated_at = now();
  end if;

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (
    p_cliente_id,
    'clube',
    'Bônus da primeira parcela liberado!',
    format('Você ganhou %s moedas e o %s no Clube de Vantagens.', v_config.pontos_primeira_parcela, v_config.voucher_primeira_parcela_titulo),
    '🎁',
    'clube',
    v_beneficio_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Redefinição de financeiro_baixar_boleto / financeiro_validar_comprovante
--    para, na MESMA transação que confirma o pagamento, notificar a cliente
--    e conceder o bônus da 1ª parcela quando aplicável. Corpo idêntico ao de
--    migration_033 (confirmado sem alterações posteriores), apenas com os
--    efeitos colaterais acrescentados no final.
-- ----------------------------------------------------------------------------
create or replace function public.financeiro_baixar_boleto(
  p_boleto_id uuid,
  p_data_pagamento date,
  p_juros numeric,
  p_multa numeric,
  p_desconto numeric,
  p_forma_pagamento text,
  p_instituicao_conta text,
  p_observacao text,
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
  if p_forma_pagamento not in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'outro') then
    raise exception 'Forma de pagamento invalida';
  end if;
  if v_juros < 0 or v_multa < 0 or v_desconto < 0 then raise exception 'Composicao financeira invalida'; end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  select * into v_recebimento
  from public.financeiro_recebimentos
  where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  if v_boleto.status = 'pago' then raise exception 'Parcela ja liquidada'; end if;

  v_total := round(v_boleto.valor + v_juros + v_multa - v_desconto, 2);
  if v_total < 0 then raise exception 'Desconto superior ao valor devido'; end if;

  insert into public.financeiro_recebimentos (
    boleto_id, cliente_id, valor_original, juros, multa, desconto, valor_recebido,
    data_pagamento, forma_pagamento, instituicao_conta, origem, status_validacao,
    comprovante_url, observacao, idempotency_key, criado_por, validado_por, validado_em
  ) values (
    v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_juros, v_multa, v_desconto, v_total,
    p_data_pagamento, p_forma_pagamento, nullif(btrim(p_instituicao_conta), ''), 'manual', 'validado',
    v_boleto.comprovante_url, nullif(btrim(p_observacao), ''), p_idempotency_key, p_usuario, p_usuario, now()
  ) returning * into v_recebimento;

  update public.boletos
  set status = 'pago', data_pagamento = p_data_pagamento,
      observacoes = coalesce(nullif(btrim(p_observacao), ''), observacoes)
  where id = v_boleto.id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'baixou_parcela_manual', 'boletos', v_boleto.id,
    jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id,
      'valor_original', v_boleto.valor, 'juros', v_juros, 'multa', v_multa,
      'desconto', v_desconto, 'valor_recebido', v_total, 'forma_pagamento', p_forma_pagamento));

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (v_boleto.cliente_id, 'parcela', 'Pagamento confirmado',
    format('Sua parcela %s foi confirmada como paga.', v_boleto.numero_parcela), '✅', 'parcelas', v_boleto.id);

  if v_boleto.numero_parcela = 1 then
    perform public.clube_conceder_bonus_primeira_parcela(v_boleto.cliente_id, v_boleto.id);
  end if;

  return v_recebimento;
end;
$$;

create or replace function public.financeiro_validar_comprovante(
  p_boleto_id uuid,
  p_acao text,
  p_observacao text,
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
begin
  if p_acao not in ('confirmar', 'rejeitar') then raise exception 'Acao de validacao invalida'; end if;
  if p_acao = 'rejeitar' and nullif(btrim(p_observacao), '') is null then
    raise exception 'Motivo da rejeicao obrigatorio';
  end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if not found then raise exception 'Parcela nao encontrada'; end if;

  select * into v_recebimento
  from public.financeiro_recebimentos
  where idempotency_key = p_idempotency_key;
  if found then return v_recebimento; end if;

  if v_boleto.status <> 'pendente_confirmacao' then raise exception 'Comprovante nao esta pendente de validacao'; end if;

  if p_acao = 'confirmar' then
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, valor_recebido, data_pagamento,
      forma_pagamento, origem, status_validacao, comprovante_url, observacao,
      idempotency_key, criado_por, validado_por, validado_em
    ) values (
      v_boleto.id, v_boleto.cliente_id, v_boleto.valor, v_boleto.valor, current_date,
      'comprovante', 'comprovante', 'validado', v_boleto.comprovante_url, nullif(btrim(p_observacao), ''),
      p_idempotency_key, p_usuario, p_usuario, now()
    ) returning * into v_recebimento;

    update public.boletos
    set status = 'pago', data_pagamento = current_date,
        observacoes = coalesce(nullif(btrim(p_observacao), ''), observacoes)
    where id = v_boleto.id;

    insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
    values (v_boleto.cliente_id, 'parcela', 'Comprovante confirmado',
      format('O comprovante da parcela %s foi confirmado pelo financeiro.', v_boleto.numero_parcela), '✅', 'parcelas', v_boleto.id);

    if v_boleto.numero_parcela = 1 then
      perform public.clube_conceder_bonus_primeira_parcela(v_boleto.cliente_id, v_boleto.id);
    end if;
  else
    insert into public.financeiro_recebimentos (
      boleto_id, cliente_id, valor_original, valor_recebido, origem, status_validacao,
      comprovante_url, observacao, motivo_rejeicao, idempotency_key, criado_por, validado_por, validado_em
    ) values (
      v_boleto.id, v_boleto.cliente_id, v_boleto.valor, 0, 'comprovante', 'rejeitado',
      v_boleto.comprovante_url, p_observacao, p_observacao, p_idempotency_key, p_usuario, p_usuario, now()
    ) returning * into v_recebimento;

    update public.boletos
    set status = 'rejeitado', data_pagamento = null, observacoes = p_observacao
    where id = v_boleto.id;

    insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
    values (v_boleto.cliente_id, 'parcela', 'Comprovante rejeitado',
      format('O comprovante da parcela %s foi rejeitado: %s', v_boleto.numero_parcela, p_observacao), '⚠️', 'parcelas', v_boleto.id);
  end if;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, case when p_acao = 'confirmar' then 'confirmou_comprovante' else 'rejeitou_comprovante' end,
    'boletos', v_boleto.id, jsonb_build_object('recebimento_id', v_recebimento.id, 'cliente_id', v_boleto.cliente_id, 'acao', p_acao));

  return v_recebimento;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Resgate atômico de prêmios (substitui o read-then-write do endpoint
--    /api/cliente/credit-ops/redeem por uma transação única com lock de
--    linha, igual ao padrão de financeiro_baixar_boleto).
-- ----------------------------------------------------------------------------
create or replace function public.clube_resgatar(
  p_cliente_id uuid,
  p_recompensa_id uuid,
  p_idempotency_key text
) returns public.clube_resgates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recompensa public.clube_recompensas%rowtype;
  v_pontos public.cliente_pontos%rowtype;
  v_resgate public.clube_resgates%rowtype;
  v_saldo_atual integer;
begin
  select * into v_resgate from public.clube_resgates where idempotency_key = p_idempotency_key;
  if found then return v_resgate; end if;

  select * into v_recompensa from public.clube_recompensas where id = p_recompensa_id and ativo = true for update;
  if not found then raise exception 'Recompensa indisponivel'; end if;

  if v_recompensa.estoque is not null and v_recompensa.estoque <= 0 then
    raise exception 'Recompensa sem estoque disponivel';
  end if;

  insert into public.cliente_pontos (cliente_id, saldo)
  values (p_cliente_id, 0)
  on conflict (cliente_id) do nothing;

  select * into v_pontos from public.cliente_pontos where cliente_id = p_cliente_id for update;
  v_saldo_atual := coalesce(v_pontos.saldo, 0);
  if v_saldo_atual < v_recompensa.pontos then raise exception 'Saldo de pontos insuficiente'; end if;

  update public.cliente_pontos
  set saldo = v_saldo_atual - v_recompensa.pontos, updated_at = now()
  where cliente_id = p_cliente_id;

  if v_recompensa.estoque is not null then
    update public.clube_recompensas set estoque = estoque - 1 where id = v_recompensa.id;
  end if;

  insert into public.clube_resgates (cliente_id, recompensa_id, pontos, status, idempotency_key)
  values (p_cliente_id, v_recompensa.id, v_recompensa.pontos, 'solicitado', p_idempotency_key)
  returning * into v_resgate;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (p_cliente_id, 'resgate', -v_recompensa.pontos, v_resgate.id::text, jsonb_build_object('recompensa_id', v_recompensa.id, 'titulo', v_recompensa.titulo));

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (p_cliente_id, 'clube', 'Resgate solicitado',
    format('Seu resgate de "%s" foi enviado para a equipe.', v_recompensa.titulo), '🎁', 'clube', v_resgate.id);

  return v_resgate;
end;
$$;

select 'Migration 048 aplicada com sucesso!' as mensagem;
