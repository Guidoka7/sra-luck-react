-- ============================================================================
-- MIGRATION 077: cliente excluída (arquivada) libera o CPF para novo cadastro
--
-- Problema: "Excluir perfil" no drawer do admin arquiva a cliente quando ela
-- tem histórico financeiro/operacional (o gatilho
-- proteger_exclusao_cliente_com_historico_financeiro impede o DELETE físico).
-- O cadastro arquivado continuava ocupando a UNIQUE (cpf), e um novo cadastro
-- com o mesmo CPF (manual ou a partir da venda do RD Station) falhava com
-- "Já existe uma cliente cadastrada com esse CPF".
--
-- Regra: o CPF é único apenas entre clientes NÃO arquivadas. O cadastro
-- arquivado continua no banco (auditoria: parcelas, carnês, recebimentos,
-- agenda), mas não conta mais para a unicidade nem para o login.
-- A venda do RD vinculada à cliente arquivada volta para "aguardando cadastro"
-- no Sra. Luck (nada é escrito no RD Station — ele é somente leitura).
--
-- Migration aditiva: adiciona colunas, troca a UNIQUE por índice único
-- parcial e cria a função de arquivamento. Nenhum dado é apagado.
-- Rollback: ver o bloco no final do arquivo.
-- ============================================================================

begin;

alter table public.clientes
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_por text;

-- Perfis já arquivados por "Excluir perfil" (inativos e cancelados, ocultos da
-- lista de clientes do admin) passam a ser marcados como arquivados.
update public.clientes c
set arquivado_em = coalesce(
      (select max(l.created_at) from public.logs_alteracoes l
       where l.entidade = 'clientes' and l.entidade_id = c.id and l.acao = 'arquivou_cliente'),
      c.updated_at,
      now()
    ),
    arquivado_por = coalesce(c.arquivado_por, 'migration_077')
where c.arquivado_em is null
  and c.ativo = false
  and c.status_contrato = 'cancelado';

alter table public.clientes drop constraint if exists clientes_cpf_key;
create unique index if not exists uq_clientes_cpf_nao_arquivada
  on public.clientes (cpf) where arquivado_em is null;
create index if not exists idx_clientes_cpf on public.clientes (cpf);

-- ----------------------------------------------------------------------------
-- Arquivamento atômico ("Excluir perfil" de cliente com histórico).
-- ----------------------------------------------------------------------------
create or replace function public.clientes_arquivar(p_cliente_id uuid, p_usuario text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_vendas uuid[];
begin
  update public.clientes
  set ativo = false,
      acesso_app_liberado = false,
      status_contrato = 'cancelado',
      suspenso_desde = null,
      suspenso_ate = null,
      suspensao_motivo = null,
      arquivado_em = coalesce(arquivado_em, now()),
      arquivado_por = coalesce(arquivado_por, p_usuario)
  where id = p_cliente_id
  returning id into v_id;

  if v_id is null then raise exception 'CLIENTE_NAO_ENCONTRADA'; end if;

  -- A venda do RD volta para a fila de cadastro local; o snapshot rd_* e o
  -- histórico continuam intactos.
  with liberadas as (
    update public.novas_vendas
    set cliente_id = null, status = 'aguardando_cadastro', updated_at = now()
    where cliente_id = p_cliente_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_vendas from liberadas;

  insert into public.logs_alteracoes(usuario, acao, entidade, entidade_id, detalhes)
  values (
    p_usuario, 'arquivou_cliente', 'clientes', p_cliente_id,
    jsonb_build_object('registroExcluido', false, 'modo', 'arquivado', 'historicoPreservado', true,
                       'cpfLiberado', true, 'vendasLiberadas', to_jsonb(v_vendas), 'escritaNoRd', false)
  );

  return v_id;
end;
$$;

revoke all on function public.clientes_arquivar(uuid, text) from public, anon, authenticated;
grant execute on function public.clientes_arquivar(uuid, text) to service_role;

commit;

-- Rollback (só se não houver dois cadastros com o mesmo CPF):
-- begin;
--   drop function if exists public.clientes_arquivar(uuid, text);
--   drop index if exists public.uq_clientes_cpf_nao_arquivada;
--   drop index if exists public.idx_clientes_cpf;
--   alter table public.clientes add constraint clientes_cpf_key unique (cpf);
-- commit;
