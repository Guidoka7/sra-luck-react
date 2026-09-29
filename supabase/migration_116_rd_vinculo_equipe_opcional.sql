-- migration_116 — vínculo do responsável do RD com a equipe passa a ser OPCIONAL.
--
-- Decisão do responsável (29/09/2026): a venda importada do RD não depende de vincular o
-- responsável do RD a uma vendedora/SDR da equipe. Antes (migration_113) toda venda sem vínculo
-- abria a pendência "vendedora_nao_vinculada" e ficava fora de vw_vendas_validas_bi.
--
-- O que muda (não destrutiva; não apaga vendas, vínculos nem histórico):
--   * rd_recalcular_pendencias_venda(): continua preenchendo vendedora_id pelo vínculo quando ele
--     existe, mas não abre mais "vendedora_nao_vinculada" e fecha as que estiverem abertas.
--   * vw_vendas_validas_bi: deixa de exigir vendedora_id (as demais regras continuam).
--   * pendências "vendedora_nao_vinculada" abertas são encerradas como descartadas, com nota.
-- A comissão continua exigindo a vendedora da cliente (regra própria, fora desta migration).
--
-- Rollback: supabase/rollback/migration_116_rollback.sql (volta a regra da 113; pendências
-- encerradas aqui reabrem no próximo recálculo).
-- Pré-requisito: migration_113 aplicada.

create or replace function public.rd_recalcular_pendencias_venda(
  p_venda_id uuid, p_origem text default null, p_importacao_id uuid default null, p_ator text default 'sistema:rd_pendencias'
) returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v public.novas_vendas%rowtype;
  c public.clientes%rowtype;
  v_cpf text; v_valor numeric; v_parcelas integer;
  v_campos text[] := '{}';
  v_abertas text[] := '{}';
  v_colab uuid;
  v_dados jsonb;
begin
  select * into v from public.novas_vendas where id = p_venda_id for update;
  if not found then return '{}'; end if;
  if v.cliente_id is not null then select * into c from public.clientes where id = v.cliente_id; end if;

  if v.vendedora_id is null and v.rd_owner_id is not null then
    select colaborador_id into v_colab from public.colaborador_vinculos_externos where provedor = 'rd_station' and id_externo = v.rd_owner_id;
    if v_colab is not null then
      update public.novas_vendas set vendedora_id = v_colab, updated_at = now() where id = v.id;
      v.vendedora_id := v_colab;
    end if;
  end if;

  v_cpf := coalesce(c.cpf, v.cpf);
  v_valor := coalesce(c.valor_contrato, v.valor_contrato);
  v_parcelas := coalesce(c.quantidade_parcelas, v.quantidade_parcelas);
  if not public.rd_cpf_valido(v_cpf) then v_campos := array_append(v_campos, 'cpf'); end if;
  if coalesce(v_valor, 0) <= 0 then v_campos := array_append(v_campos, 'valor_contrato'); end if;
  if coalesce(v_parcelas, 0) <= 0 then v_campos := array_append(v_campos, 'quantidade_parcelas'); end if;

  -- Sem dados pessoais na fila: só identificadores técnicos e o que falta.
  v_dados := jsonb_build_object('rd_status', v.rd_status, 'status_venda', v.status, 'tem_cliente', v.cliente_id is not null);

  if v.rd_excluido_em is not null or v.rd_status = 'deleted' then
    perform public.integracao_registrar_pendencia('rd_station', 'excluida_no_rd', v.rd_station_id,
      'A negociação foi excluída no RD Station.', 'Conferir e descartar a venda se não houver cliente.', '{}', p_origem, p_importacao_id, v.id, v_dados, false);
    v_abertas := array_append(v_abertas, 'excluida_no_rd');
  end if;
  if cardinality(v_campos) > 0 then
    perform public.integracao_registrar_pendencia('rd_station', 'campos_ausentes', v.rd_station_id,
      'Venda sem ' || array_to_string(v_campos, ', ') || '.', 'Completar no cadastro da cliente e reprocessar.', v_campos, p_origem, p_importacao_id, v.id, v_dados, false);
    v_abertas := array_append(v_abertas, 'campos_ausentes');
  end if;
  -- Vínculo com a equipe é OPCIONAL (decisão do responsável, 29/09/2026): sem vínculo a venda
  -- continua válida e mantém o nome do responsável vindo do RD. Não abre pendência.

  if coalesce(v.rd_status, '') not in ('won', 'deleted') then
    perform public.integracao_registrar_pendencia('rd_station', 'status_nao_ganha', v.rd_station_id,
      'A negociação está "' || coalesce(v.rd_status, 'sem status') || '" no RD, não ganha.', 'Confirmar a venda ou descartar.', '{}', p_origem, p_importacao_id, v.id, v_dados, false);
    v_abertas := array_append(v_abertas, 'status_nao_ganha');
  end if;

  -- Fecha o que deixou de valer (inclusive erro/fora do funil, já que a venda existe).
  perform public.integracao_resolver_pendencias('rd_station', v.rd_station_id,
    array(select t from unnest(array['campos_ausentes','vendedora_nao_vinculada','status_nao_ganha','excluida_no_rd','negociacao_com_erro','ganha_fora_do_funil']) t where t <> all(v_abertas)),
    p_ator);
  return v_abertas;
end $$;

create or replace view public.vw_vendas_validas_bi with (security_invoker = on) as
select v.id, v.rd_station_id, v.cliente_id, v.vendedora_id, v.data_venda,
       coalesce(c.valor_contrato, v.valor_contrato) as valor_contrato
from public.novas_vendas v
left join public.clientes c on c.id = v.cliente_id
where v.rd_status = 'won' and v.rd_excluido_em is null
  and public.rd_cpf_valido(coalesce(c.cpf, v.cpf))
  and coalesce(c.valor_contrato, v.valor_contrato, 0) > 0
  and not exists (select 1 from public.integracao_pendencias p where p.nova_venda_id = v.id and p.estado = 'aberta');

revoke all on public.vw_vendas_validas_bi from anon, authenticated;
grant select on public.vw_vendas_validas_bi to service_role;
revoke all on function public.rd_recalcular_pendencias_venda(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.rd_recalcular_pendencias_venda(uuid, text, uuid, text) to service_role;

update public.integracao_pendencias
   set estado = 'descartada', resolucao = 'descartada', resolvido_por = 'sistema:migration_116', resolvido_em = now(),
       nota = 'Vínculo com a equipe passou a ser opcional; a venda não depende dele.'
 where provedor = 'rd_station' and tipo = 'vendedora_nao_vinculada' and estado = 'aberta';
