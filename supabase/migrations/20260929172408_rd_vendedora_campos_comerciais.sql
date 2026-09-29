-- Vendedora do RD: nome-da-vendedora, seguido de vendedora-que-realizou-a-reuniao.
-- Nenhum vínculo à equipe pode decorrer do proprietário da negociação.
-- Só associa pelo nome completo exato quando houver uma única vendedora ativa.
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

  -- O proprietário da negociação não é necessariamente quem realizou a venda.
  -- Vincula à equipe apenas um nome comercial completo e único, em pré cadastro.
  if v.cliente_id is null and v.status = 'aguardando_cadastro' then
    select case when count(*) = 1 then (array_agg(id))[1] end into v_colab
      from public.colaboradores
     where ativo is true and cargo = 'vendedora'
       and lower(btrim(nome)) = lower(btrim(v.vendedora_responsavel));
    if v.vendedora_id is distinct from v_colab then
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
  -- continua válida e mantém o nome comercial vindo do RD. Não abre pendência.

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


-- Corrige os pré cadastros já importados, sem tocar em campos editados pela equipe.
-- O nome do RD permanece visível mesmo quando não existe colaboradora correspondente.
with campos as (
  select v.id,
         coalesce(nullif(btrim(v.rd_snapshot->'custom_fields'->>'nome-da-vendedora'), ''),
                  nullif(btrim(v.rd_snapshot->'custom_fields'->>'vendedora-que-realizou-a-reuniao'), '')) as nome
    from public.novas_vendas v
   where v.rd_station_id is not null and v.cliente_id is null and v.status = 'aguardando_cadastro'
     and not exists (
       select 1 from public.logs_alteracoes l
        where l.entidade_id = v.id and l.acao = 'editou_venda_local_sem_sync_rd'
          and l.detalhes->'campos' ? 'vendedora_responsavel'
     )
), encontrados as (
  select campos.id, campos.nome,
         (select case when count(*) = 1 then (array_agg(c.id))[1] end
            from public.colaboradores c
           where c.ativo is true and c.cargo = 'vendedora'
             and lower(btrim(c.nome)) = lower(btrim(campos.nome))) as equipe_id
    from campos
)
update public.novas_vendas v
   set vendedora_responsavel = e.nome, vendedora_id = e.equipe_id, updated_at = now()
  from encontrados e
 where v.id = e.id
   and (v.vendedora_responsavel is distinct from e.nome or v.vendedora_id is distinct from e.equipe_id);

revoke all on function public.rd_recalcular_pendencias_venda(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.rd_recalcular_pendencias_venda(uuid, text, uuid, text) to service_role;
