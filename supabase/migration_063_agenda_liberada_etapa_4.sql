-- migration_063_agenda_liberada_etapa_4.sql
-- Compatibilidade: agenda_liberada() reflete a Etapa 4 definitiva.

create or replace function public.agenda_liberada(p_cliente_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.pode_agendar(p_cliente_id)
    and exists (
      select 1
      from public.clientes c
      where c.id = p_cliente_id
        and c.status_revisao_financeira = 'aprovada'
        and c.financeiro_confirmado_em is not null
    )
    and exists (
      select 1
      from public.solicitacoes_liberacao_financeira s
      where s.cliente_id = p_cliente_id
        and s.status in ('pendente','em_analise','aprovada')
    );
$$;

comment on function public.agenda_liberada(uuid) is
  'Agenda definitiva: true somente após 70% real, levantamento confirmado e forma de quitação escolhida.';
