-- migration_062_agenda_quitacao_valor_editado.sql
-- Corrige a quitação integral da Agenda quando o financeiro edita o saldo final.
-- O valor confirmado no levantamento pode divergir da soma nominal das parcelas
-- em aberto. Para manter o histórico financeiro consistente com as constraints
-- reais de financeiro_recebimentos:
--   - valor abaixo do nominal vira desconto distribuído proporcionalmente;
--   - valor acima do nominal vira juros distribuídos proporcionalmente.
-- Assim valor_recebido = valor_original + juros + multa - desconto em cada linha.

create or replace function public.agenda_registrar_quitacao(
  p_agendamento_id uuid,
  p_recebido boolean,
  p_usuario text,
  p_idempotency_key text
)
returns public.agendamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agendamentos%rowtype;
  v_cliente public.clientes%rowtype;
  v_escolha public.solicitacoes_liberacao_financeira%rowtype;
  v_boleto public.boletos%rowtype;
  v_aberto numeric := 0;
  v_total_final numeric := 0;
  v_alocado numeric := 0;
  v_valor numeric := 0;
  v_juros numeric := 0;
  v_desconto numeric := 0;
  v_forma text;
  v_count integer := 0;
  v_index integer := 0;
begin
  select * into v
  from public.agendamentos
  where id = p_agendamento_id
    and status in ('confirmado','realizado')
  for update;

  if not found then raise exception 'AGENDAMENTO_NAO_ENCONTRADO'; end if;

  select * into v_cliente
  from public.clientes
  where id = v.cliente_id
  for update;

  select * into v_escolha
  from public.solicitacoes_liberacao_financeira
  where cliente_id = v.cliente_id
    and status in ('pendente','em_analise','aprovada')
  order by created_at desc
  limit 1;

  if p_recebido then
    if v.previsao_cirurgia_confirmada_em is null then raise exception 'PREVISAO_NAO_CONFIRMADA'; end if;
    if v_escolha.id is null then raise exception 'FORMA_QUITACAO_NAO_ESCOLHIDA'; end if;
    if v.quitacao_status = 'paga' then return v; end if;

    v_total_final := round(coalesce(v_cliente.financeiro_saldo_restante,0),2);
    if v_total_final < 0 then raise exception 'SALDO_FINAL_INVALIDO'; end if;

    select coalesce(sum(valor),0), count(*)
    into v_aberto, v_count
    from public.boletos
    where cliente_id = v.cliente_id
      and status <> 'pago';

    if v_count = 0 and v_total_final > 0 then raise exception 'PARCELAS_ABERTAS_NAO_ENCONTRADAS'; end if;

    v_forma := case v_escolha.forma_custeio::text
      when 'cartao' then 'cartao'
      when 'pix' then 'pix'
      when 'cheques' then 'cheque'
      when 'boleto_100' then 'boleto'
      else 'outro'
    end;

    for v_boleto in
      select *
      from public.boletos
      where cliente_id = v.cliente_id
        and status <> 'pago'
      order by numero_parcela
      for update
    loop
      v_index := v_index + 1;

      if v_index = v_count then
        v_valor := round(v_total_final - v_alocado,2);
      elsif v_aberto > 0 then
        v_valor := round(v_total_final * (v_boleto.valor / v_aberto),2);
      else
        v_valor := 0;
      end if;

      v_valor := greatest(0, v_valor);
      v_alocado := v_alocado + v_valor;

      if v_valor >= v_boleto.valor then
        v_juros := round(v_valor - v_boleto.valor,2);
        v_desconto := 0;
      else
        v_juros := 0;
        v_desconto := round(v_boleto.valor - v_valor,2);
      end if;

      insert into public.financeiro_recebimentos(
        boleto_id,cliente_id,valor_original,juros,multa,desconto,valor_recebido,data_pagamento,
        forma_pagamento,origem,status_validacao,observacao,
        idempotency_key,criado_por,validado_por,validado_em
      ) values (
        v_boleto.id,v.cliente_id,v_boleto.valor,v_juros,0,v_desconto,v_valor,
        (timezone('America/Sao_Paulo',now()))::date,
        v_forma,'manual','validado',
        'Quitação integral confirmada na Liberação Financeira. Valor final definido no levantamento.',
        p_idempotency_key||':'||v_boleto.id::text,p_usuario,p_usuario,now()
      )
      on conflict (idempotency_key) do nothing;

      update public.boletos
      set status = 'pago',
          data_pagamento = (timezone('America/Sao_Paulo',now()))::date,
          observacoes = coalesce(observacoes,'') ||
            case when coalesce(observacoes,'')='' then '' else E'\n' end ||
            'Quitação integral confirmada na Liberação Financeira. Valor final definido no levantamento.',
          updated_at = now()
      where id = v_boleto.id;
    end loop;

    if round(v_alocado,2) <> round(v_total_final,2) then
      raise exception 'DISTRIBUICAO_QUITACAO_INVALIDA';
    end if;

    update public.agendamentos
    set quitacao_status = 'paga',
        quitacao_em = now(),
        quitacao_metodo = v_escolha.forma_custeio::text,
        updated_at = now()
    where id = p_agendamento_id
    returning * into v;

    update public.clientes
    set custeio_confirmado_em = coalesce(custeio_confirmado_em,now()),
        status_financeiro = 'pago',
        updated_at = now()
    where id = v.cliente_id;

    perform public.agenda_tentar_liberar_cirurgia(p_agendamento_id,p_usuario);

    insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values (
      p_usuario,'confirmou_quitacao_saldo','agendamentos',p_agendamento_id,
      jsonb_build_object(
        'cliente_id',v.cliente_id,
        'valor_nominal_aberto',v_aberto,
        'valor_recebido',v_total_final,
        'ajuste_financeiro',round(v_total_final-v_aberto,2),
        'forma',v_escolha.forma_custeio,
        'parcelas_liquidadas',v_count
      )
    );
  else
    if v.quitacao_status = 'paga' then raise exception 'QUITACAO_JA_CONFIRMADA'; end if;

    update public.agendamentos
    set quitacao_status = 'nao_realizada',
        quitacao_em = now(),
        quitacao_metodo = coalesce(v_escolha.forma_custeio::text,quitacao_metodo),
        status = 'cancelado',
        agenda_cirurgica_liberada_em = null,
        updated_at = now()
    where id = p_agendamento_id
    returning * into v;

    update public.solicitacoes_liberacao_financeira
    set agendamento_id = null, updated_at = now()
    where agendamento_id = p_agendamento_id;

    insert into public.logs_alteracoes(usuario,acao,entidade,entidade_id,detalhes)
    values (
      p_usuario,'registrou_pagamento_nao_realizado','agendamentos',p_agendamento_id,
      jsonb_build_object('cliente_id',v.cliente_id,'retorno','etapa_4','vaga_liberada',true)
    );
  end if;

  return v;
end;
$$;

revoke all on function public.agenda_registrar_quitacao(uuid,boolean,text,text) from public, anon, authenticated;
grant execute on function public.agenda_registrar_quitacao(uuid,boolean,text,text) to service_role;

comment on function public.agenda_registrar_quitacao(uuid,boolean,text,text) is
  'Quitação da Liberação Financeira usando o saldo final editável do levantamento. Diferenças contra o nominal são persistidas como desconto ou juros por parcela, preservando constraints e auditoria.';
