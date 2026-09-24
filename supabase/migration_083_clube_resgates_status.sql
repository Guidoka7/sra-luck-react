-- Processamento atômico dos resgates do Clube.
-- Garante transições válidas e devolve pontos/estoque uma única vez ao cancelar.

create or replace function public.clube_atualizar_resgate(
  p_resgate_id uuid,
  p_status text,
  p_usuario text
) returns public.clube_resgates
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_resgate public.clube_resgates%rowtype;
  v_recompensa public.clube_recompensas%rowtype;
  v_mensagem text;
begin
  if p_resgate_id is null then
    raise exception 'Resgate nao encontrado';
  end if;
  if p_status not in ('aprovado','separacao','entregue','cancelado') then
    raise exception 'Transicao de resgate invalida';
  end if;

  select * into v_resgate
    from public.clube_resgates
   where id = p_resgate_id
   for update;

  if not found then
    raise exception 'Resgate nao encontrado';
  end if;

  if v_resgate.status = p_status then
    return v_resgate;
  end if;

  if v_resgate.status in ('entregue','cancelado') then
    raise exception 'Resgate ja finalizado';
  end if;

  if not (
    (v_resgate.status = 'solicitado' and p_status in ('aprovado','cancelado')) or
    (v_resgate.status = 'aprovado' and p_status in ('separacao','cancelado')) or
    (v_resgate.status = 'separacao' and p_status in ('entregue','cancelado'))
  ) then
    raise exception 'Transicao de resgate invalida';
  end if;

  select * into v_recompensa
    from public.clube_recompensas
   where id = v_resgate.recompensa_id
   for update;

  if p_status = 'cancelado' then
    insert into public.cliente_pontos (cliente_id, saldo)
    values (v_resgate.cliente_id, v_resgate.pontos)
    on conflict (cliente_id) do update
      set saldo = public.cliente_pontos.saldo + excluded.saldo,
          updated_at = now();

    if found and v_recompensa.estoque is not null then
      update public.clube_recompensas
         set estoque = estoque + 1
       where id = v_resgate.recompensa_id;
    end if;

    insert into public.cliente_pontos_eventos (cliente_id, tipo, pontos, referencia, metadata)
    values (
      v_resgate.cliente_id,
      'ajuste',
      v_resgate.pontos,
      v_resgate.id::text,
      jsonb_build_object(
        'motivo','cancelamento_resgate',
        'resgate_id',v_resgate.id,
        'recompensa_id',v_resgate.recompensa_id,
        'usuario',coalesce(nullif(btrim(p_usuario),''),'admin')
      )
    );

    v_mensagem := 'Seu resgate foi cancelado. Os pontos foram devolvidos ao seu saldo.';
  elsif p_status = 'aprovado' then
    v_mensagem := 'Seu resgate foi aprovado e seguirá para preparação.';
  elsif p_status = 'separacao' then
    v_mensagem := 'Seu benefício está em separação pela equipe Sra. Luck.';
  else
    v_mensagem := 'Seu resgate foi concluído e marcado como entregue.';
  end if;

  update public.clube_resgates
     set status = p_status,
         updated_at = now()
   where id = v_resgate.id
   returning * into v_resgate;

  insert into public.notificacoes_cliente (cliente_id, tipo, titulo, mensagem, emoji, destino, referencia_id)
  values (
    v_resgate.cliente_id,
    'clube',
    case p_status
      when 'aprovado' then 'Resgate aprovado'
      when 'separacao' then 'Benefício em separação'
      when 'entregue' then 'Resgate entregue'
      else 'Resgate cancelado'
    end,
    v_mensagem,
    case when p_status = 'cancelado' then '↩️' else '🎁' end,
    'clube',
    v_resgate.id
  );

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (
    coalesce(nullif(btrim(p_usuario),''),'admin'),
    'alterou_status_resgate_clube',
    'clube_resgates',
    v_resgate.id,
    jsonb_build_object(
      'status',p_status,
      'cliente_id',v_resgate.cliente_id,
      'recompensa_id',v_resgate.recompensa_id,
      'pontos',v_resgate.pontos
    )
  );

  return v_resgate;
end;
$$;

revoke all on function public.clube_atualizar_resgate(uuid,text,text) from public, anon, authenticated;
grant execute on function public.clube_atualizar_resgate(uuid,text,text) to service_role;
