-- migration_112 — levantamento financeiro (Etapa 2) gravado de forma atômica.
--
-- Antes: POST /api/admin/clientes/:id/revisao-financeira fazia UPDATE em
-- clientes e, em outra chamada, INSERT em logs_alteracoes. Se a auditoria
-- falhasse, a decisão financeira ficava gravada sem histórico e a API
-- respondia sucesso.
--
-- Agora: decisão, responsável e auditoria em UMA transação. Qualquer erro
-- (inclusive no INSERT da auditoria) desfaz tudo e a API responde erro.
-- A linha da cliente fica travada (FOR UPDATE) durante a decisão, então a
-- data de confirmação e a ação auditada usam o status realmente anterior.
--
-- Mesmas regras de montarPatchRevisaoFinanceira (worker/admin-api.ts), que
-- continua validando antes de chamar a RPC; aqui elas são repetidas porque o
-- banco é a última barreira.
--
-- Não destrutiva: só cria a função. Rollback: supabase/rollback/migration_112_rollback.sql.
-- Ordem de publicação: aplicar esta migration ANTES de promover o App que a chama.

create or replace function public.agenda_registrar_levantamento(
  p_cliente_id uuid,
  p_decisao text,
  p_saldo_restante numeric,
  p_formas text[],
  p_taxa_cartao numeric,
  p_observacao text,
  p_usuario text
)
returns public.clientes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual public.clientes%rowtype;
  v_novo public.clientes%rowtype;
  v_formas text[];
  v_forma text;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_acao text;
begin
  if nullif(btrim(coalesce(p_usuario, '')), '') is null then raise exception 'USUARIO_OBRIGATORIO'; end if;
  if p_decisao is null or p_decisao not in ('aprovada', 'recusada') then raise exception 'DECISAO_INVALIDA'; end if;

  select * into v_atual from public.clientes where id = p_cliente_id for update;
  if not found then raise exception 'CLIENTE_NAO_ENCONTRADA'; end if;

  if p_taxa_cartao is not null and (p_taxa_cartao < 0 or p_taxa_cartao > 100) then raise exception 'TAXA_CARTAO_INVALIDA'; end if;

  if p_decisao = 'aprovada' then
    if p_saldo_restante is null or p_saldo_restante < 0 then raise exception 'SALDO_INVALIDO'; end if;
    -- Sem repetição, na ordem informada pela equipe.
    select coalesce(array_agg(f order by o), '{}') into v_formas
      from (select f, min(o) o from unnest(coalesce(p_formas, '{}')) with ordinality u(f, o) group by f) s;
    if coalesce(array_length(v_formas, 1), 0) = 0 then raise exception 'FORMAS_QUITACAO_OBRIGATORIAS'; end if;
    foreach v_forma in array v_formas loop
      if v_forma not in ('cartao', 'pix', 'cheques', 'boleto_100') then raise exception 'FORMA_QUITACAO_INVALIDA'; end if;
    end loop;

    update public.clientes set
      status_revisao_financeira = 'aprovada',
      observacao_revisao_financeira = v_obs,
      financeiro_saldo_restante = round(p_saldo_restante, 2),
      financeiro_formas_custeio = v_formas,
      financeiro_taxa_cartao = coalesce(p_taxa_cartao, financeiro_taxa_cartao),
      financeiro_confirmado_em = case when v_atual.status_revisao_financeira = 'aprovada' then financeiro_confirmado_em else now() end,
      financeiro_levantamento_confirmado_por = p_usuario,
      updated_at = now()
    where id = p_cliente_id
    returning * into v_novo;

    v_acao := case when v_atual.status_revisao_financeira = 'aprovada' then 'editou_levantamento_financeiro' else 'confirmou_levantamento_financeiro' end;
  else
    if p_saldo_restante is not null and p_saldo_restante < 0 then raise exception 'SALDO_INVALIDO'; end if;
    update public.clientes set
      status_revisao_financeira = 'recusada',
      observacao_revisao_financeira = v_obs,
      financeiro_saldo_restante = coalesce(round(p_saldo_restante, 2), financeiro_saldo_restante),
      financeiro_taxa_cartao = coalesce(p_taxa_cartao, financeiro_taxa_cartao),
      financeiro_formas_custeio = coalesce(p_formas, financeiro_formas_custeio),
      updated_at = now()
    where id = p_cliente_id
    returning * into v_novo;

    v_acao := 'registrou_divergencia_levantamento';
  end if;

  -- Sem texto livre da observação na auditoria (LGPD); só se foi informada.
  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, v_acao, 'clientes', p_cliente_id, jsonb_build_object(
    'de', v_atual.status_revisao_financeira,
    'para', v_novo.status_revisao_financeira,
    'saldo_final', v_novo.financeiro_saldo_restante,
    'formas_quitacao', to_jsonb(v_novo.financeiro_formas_custeio),
    'taxa_cartao', v_novo.financeiro_taxa_cartao,
    'observacaoInformada', v_obs is not null
  ));

  return v_novo;
end;
$$;

comment on function public.agenda_registrar_levantamento(uuid, text, numeric, text[], numeric, text, text) is
  'Etapa 2: decisão do levantamento, responsável e auditoria na mesma transação (migration_112).';

revoke all on function public.agenda_registrar_levantamento(uuid, text, numeric, text[], numeric, text, text) from public, anon, authenticated;
grant execute on function public.agenda_registrar_levantamento(uuid, text, numeric, text[], numeric, text, text) to service_role;
