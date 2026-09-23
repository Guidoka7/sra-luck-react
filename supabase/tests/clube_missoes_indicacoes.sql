-- Clube v2 (migration 075): parcela em dia, indicação e idempotência.
-- Fixtures controladas; sempre faz rollback.
begin;
do $$
declare
  ana uuid; bia uuid; p1 uuid; p2 uuid; b1 uuid; ind uuid; v_saldo integer; falhou boolean;
begin
  insert into public.clientes(nome_completo) values ('QA Clube Ana') returning id into ana;
  insert into public.clientes(nome_completo) values ('QA Clube Bia') returning id into bia;
  insert into public.boletos(cliente_id,numero_parcela,total_parcelas,valor,data_vencimento) values (ana,1,12,100,'2026-09-10') returning id into p1;
  insert into public.boletos(cliente_id,numero_parcela,total_parcelas,valor,data_vencimento) values (ana,2,12,100,'2026-10-10') returning id into p2;

  update public.boletos set status='pago', data_pagamento='2026-09-09' where id=p1;
  select coalesce(max(c.saldo),0) into v_saldo from public.cliente_pontos c where c.cliente_id=ana;
  if v_saldo <> 60 then raise exception '1a parcela em dia deveria somar 50+10, saldo %', v_saldo; end if;

  update public.boletos set status='pago', data_pagamento='2026-10-15' where id=p2;
  select c.saldo into v_saldo from public.cliente_pontos c where c.cliente_id=ana;
  if v_saldo <> 60 then raise exception 'parcela atrasada nao pode pontuar, saldo %', v_saldo; end if;

  update public.boletos set status='nao_pago' where id=p1;
  update public.boletos set status='pago', data_pagamento='2026-09-09' where id=p1;
  select c.saldo into v_saldo from public.cliente_pontos c where c.cliente_id=ana;
  if v_saldo <> 60 then raise exception 'reconfirmar parcela nao pode creditar de novo, saldo %', v_saldo; end if;

  insert into public.indicacoes_clientes(indicador_cliente_id,nome_indicado,telefone_indicado) values (ana,'QA Bia','61999990000') returning id into ind;
  falhou := false;
  begin perform public.clube_atualizar_indicacao(ind,'venda',null,null,'qa'); exception when others then falhou := true; end;
  if not falhou then raise exception 'Fechou sem cliente vinculada deveria falhar'; end if;

  perform public.clube_atualizar_indicacao(ind,'venda',bia,'qa','qa');
  select c.saldo into v_saldo from public.cliente_pontos c where c.cliente_id=ana;
  if v_saldo <> 60 then raise exception 'sem 1a parcela da indicada nao credita, saldo %', v_saldo; end if;

  insert into public.boletos(cliente_id,numero_parcela,total_parcelas,valor,data_vencimento) values (bia,1,12,100,'2026-09-20') returning id into b1;
  update public.boletos set status='pago', data_pagamento='2026-09-25' where id=b1;
  select c.saldo into v_saldo from public.cliente_pontos c where c.cliente_id=ana;
  if v_saldo <> 260 then raise exception 'indicacao fechada + 1a parcela paga deveria somar 200, saldo %', v_saldo; end if;

  perform public.clube_atualizar_indicacao(ind,'venda',bia,'de novo','qa');
  select c.saldo into v_saldo from public.cliente_pontos c where c.cliente_id=ana;
  if v_saldo <> 260 then raise exception 'indicacao nao pode creditar duas vezes, saldo %', v_saldo; end if;
end $$;
rollback;
