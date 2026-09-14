-- ============================================================================
-- MIGRATION 035: Endurecimento do Clube de Vantagens + configuração de cartão
--
-- Contexto: o backend do Clube de Vantagens (migration_022) já existe
-- (clube_recompensas, cliente_pontos, cliente_pontos_eventos,
-- indicacoes_clientes, clube_resgates) mas nunca foi exposto na experiência
-- real da cliente e tinha duas lacunas: (1) o resgate de pontos não era
-- atômico (race condition possível em cliques concorrentes) e (2) não havia
-- como conceder benefícios que não custam pontos (voucher da 1ª parcela).
--
-- Esta migration é ADITIVA: não remove nem renomeia nada existente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Configuração de cartão de crédito (estende a tabela singleton já usada
--    para PIX/WhatsApp em migration_005_pix_contato.sql, em vez de criar uma
--    fonte de configuração paralela).
-- ----------------------------------------------------------------------------
alter table configuracoes
  add column if not exists cartao_habilitado boolean not null default false,
  add column if not exists cartao_taxa_percentual numeric(5,2) not null default 5.4,
  add column if not exists cartao_max_parcelas integer,
  add column if not exists cartao_provider text;

comment on column configuracoes.cartao_habilitado is 'Habilita a opção de cartão de crédito no pagamento de parcelas individuais no app da cliente.';
comment on column configuracoes.cartao_taxa_percentual is 'Taxa percentual aplicada sobre o valor da parcela quando paga no cartão.';
comment on column configuracoes.cartao_max_parcelas is 'Número máximo de parcelas do cartão aceitas, quando aplicável. Nulo = sem parcelamento adicional.';
comment on column configuracoes.cartao_provider is 'Identificador do provedor de pagamento de cartão configurado (ex.: mercado_pago). Nulo enquanto nenhum gateway estiver integrado.';

-- ----------------------------------------------------------------------------
-- 2. Catálogo de prêmios: ordenação, ícone e instruções pós-resgate.
-- ----------------------------------------------------------------------------
alter table clube_recompensas
  add column if not exists ordem integer not null default 0,
  add column if not exists icone_key text,
  add column if not exists instrucoes_pos_resgate text;

-- ----------------------------------------------------------------------------
-- 3. Resgates: observação administrativa + chave de idempotência para o
--    débito atômico (mesmo padrão de financeiro_recebimentos.idempotency_key).
-- ----------------------------------------------------------------------------
alter table clube_resgates
  add column if not exists observacao_admin text,
  add column if not exists idempotency_key text;

create unique index if not exists idx_clube_resgates_idempotency_key
  on clube_resgates(idempotency_key) where idempotency_key is not null;

-- ----------------------------------------------------------------------------
-- 4. Benefícios não pontuáveis da cliente (ex.: voucher de consulta liberado
--    pela confirmação da 1ª parcela). Ledger de pontos continua em
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
-- 5. Configuração do Clube (singleton) — pontos por indicação confirmada,
--    bônus e ativação do voucher da 1ª parcela. Valores default espelham o
--    protótipo aprovado (+150 por indicação, +50 na 1ª parcela).
-- ----------------------------------------------------------------------------
create table if not exists clube_config (
  id integer primary key default 1 check (id = 1),
  pontos_por_indicacao integer not null default 150,
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
-- 6. Bônus idempotente da 1ª parcela — chamado de dentro das transações que
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
-- 7. Redefinição de financeiro_baixar_boleto / financeiro_validar_comprovante
--    para, na MESMA transação que confirma o pagamento, notificar a cliente
--    e conceder o bônus da 1ª parcela quando aplicável. Corpo idêntico ao de
--    migration_033, apenas com os efeitos colaterais acrescentados no final.
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
-- 8. Resgate atômico de prêmios (substitui o read-then-write do endpoint
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

-- ----------------------------------------------------------------------------
-- 9. Fila administrativa de resgates: aprovar / colocar em separação /
--    marcar entregue / cancelar (com estorno automático de pontos quando o
--    cancelamento ocorre antes da entrega).
-- ----------------------------------------------------------------------------
create or replace function public.clube_atualizar_resgate(
  p_resgate_id uuid,
  p_status text,
  p_observacao text,
  p_usuario text
) returns public.clube_resgates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_resgate public.clube_resgates%rowtype;
begin
  if p_status not in ('aprovado','separacao','entregue','cancelado') then
    raise exception 'Status de resgate invalido';
  end if;

  select * into v_resgate from public.clube_resgates where id = p_resgate_id for update;
  if not found then raise exception 'Resgate nao encontrado'; end if;
  if v_resgate.status in ('entregue','cancelado') then
    raise exception 'Resgate ja finalizado e nao pode ser alterado';
  end if;

  if p_status = 'cancelado' then
    update public.cliente_pontos
    set saldo = saldo + v_resgate.pontos, updated_at = now()
    where cliente_id = v_resgate.cliente_id;

    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (v_resgate.cliente_id, 'ajuste', v_resgate.pontos, v_resgate.id::text, jsonb_build_object('motivo', 'estorno_resgate_cancelado'));

    update public.clube_recompensas set estoque = estoque + 1
    where id = v_resgate.recompensa_id and estoque is not null;
  end if;

  update public.clube_resgates
  set status = p_status,
      observacao_admin = coalesce(nullif(btrim(p_observacao), ''), observacao_admin),
      updated_at = now()
  where id = p_resgate_id
  returning * into v_resgate;

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (
    v_resgate.cliente_id, 'clube',
    case p_status
      when 'aprovado' then 'Resgate aprovado'
      when 'separacao' then 'Resgate em separação'
      when 'entregue' then 'Resgate entregue'
      else 'Resgate cancelado'
    end,
    case p_status
      when 'aprovado' then 'Seu resgate foi aprovado pela equipe.'
      when 'separacao' then 'Seu benefício está em separação.'
      when 'entregue' then 'Seu benefício foi entregue. Aproveite!'
      else format('Seu resgate foi cancelado. %s moedas foram devolvidas ao seu saldo.', v_resgate.pontos)
    end,
    case p_status when 'cancelado' then '↩️' else '🎁' end,
    'clube', v_resgate.id
  );

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'atualizou_resgate_clube', 'clube_resgates', v_resgate.id,
    jsonb_build_object('cliente_id', v_resgate.cliente_id, 'status', p_status, 'observacao', p_observacao));

  return v_resgate;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Confirmação/rejeição de indicação com crédito idempotente de pontos.
--     Reaproveita a coluna pontos_creditados (default 0) já existente como
--     guarda de idempotência: só credita quando ainda esta em 0.
-- ----------------------------------------------------------------------------
create or replace function public.clube_confirmar_indicacao(
  p_indicacao_id uuid,
  p_usuario text
) returns public.indicacoes_clientes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_indicacao public.indicacoes_clientes%rowtype;
  v_config public.clube_config%rowtype;
begin
  select * into v_indicacao from public.indicacoes_clientes where id = p_indicacao_id for update;
  if not found then raise exception 'Indicacao nao encontrada'; end if;

  update public.indicacoes_clientes set status = 'venda' where id = p_indicacao_id;

  if v_indicacao.pontos_creditados = 0 then
    select * into v_config from public.clube_config where id = 1;
    if found and v_config.pontos_por_indicacao > 0 then
      update public.indicacoes_clientes set pontos_creditados = v_config.pontos_por_indicacao where id = p_indicacao_id;

      insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
      values (v_indicacao.indicador_cliente_id, 'indicacao', v_config.pontos_por_indicacao, v_indicacao.id::text,
        jsonb_build_object('nome_indicado', v_indicacao.nome_indicado));

      insert into public.cliente_pontos (cliente_id, saldo, updated_at)
      values (v_indicacao.indicador_cliente_id, v_config.pontos_por_indicacao, now())
      on conflict (cliente_id) do update
        set saldo = public.cliente_pontos.saldo + excluded.saldo, updated_at = now();

      insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
      values (v_indicacao.indicador_cliente_id, 'clube', 'Indicação confirmada!',
        format('Sua indicação de %s foi confirmada. Você ganhou %s moedas.', v_indicacao.nome_indicado, v_config.pontos_por_indicacao),
        '🎉', 'clube', v_indicacao.id);
    end if;
  end if;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'confirmou_indicacao_clube', 'indicacoes_clientes', p_indicacao_id,
    jsonb_build_object('indicador_cliente_id', v_indicacao.indicador_cliente_id));

  select * into v_indicacao from public.indicacoes_clientes where id = p_indicacao_id;
  return v_indicacao;
end;
$$;

create or replace function public.clube_rejeitar_indicacao(
  p_indicacao_id uuid,
  p_usuario text
) returns public.indicacoes_clientes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_indicacao public.indicacoes_clientes%rowtype;
begin
  update public.indicacoes_clientes set status = 'invalidada' where id = p_indicacao_id
  returning * into v_indicacao;
  if not found then raise exception 'Indicacao nao encontrada'; end if;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'rejeitou_indicacao_clube', 'indicacoes_clientes', p_indicacao_id,
    jsonb_build_object('indicador_cliente_id', v_indicacao.indicador_cliente_id));

  return v_indicacao;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Ajuste manual auditado do saldo de pontos (admin).
-- ----------------------------------------------------------------------------
create or replace function public.clube_ajuste_manual(
  p_cliente_id uuid,
  p_pontos integer,
  p_motivo text,
  p_usuario text
) returns public.cliente_pontos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pontos public.cliente_pontos%rowtype;
begin
  if p_pontos = 0 then raise exception 'Informe uma quantidade de pontos diferente de zero'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Motivo do ajuste obrigatorio'; end if;

  insert into public.cliente_pontos (cliente_id, saldo)
  values (p_cliente_id, 0)
  on conflict (cliente_id) do nothing;

  select * into v_pontos from public.cliente_pontos where cliente_id = p_cliente_id for update;
  if v_pontos.saldo + p_pontos < 0 then raise exception 'Ajuste deixaria o saldo negativo'; end if;

  update public.cliente_pontos set saldo = saldo + p_pontos, updated_at = now()
  where cliente_id = p_cliente_id
  returning * into v_pontos;

  insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
  values (p_cliente_id, 'ajuste', p_pontos, null, jsonb_build_object('motivo', p_motivo, 'usuario', p_usuario));

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino)
  values (p_cliente_id, 'clube',
    case when p_pontos > 0 then 'Crédito no Clube de Vantagens' else 'Ajuste no Clube de Vantagens' end,
    format('%s%s moedas: %s', case when p_pontos > 0 then '+' else '' end, p_pontos, p_motivo),
    '🪙', 'clube');

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'ajustou_pontos_clube', 'cliente_pontos', p_cliente_id,
    jsonb_build_object('pontos', p_pontos, 'motivo', p_motivo));

  return v_pontos;
end;
$$;

select 'Migration 035 aplicada com sucesso!' as mensagem;
