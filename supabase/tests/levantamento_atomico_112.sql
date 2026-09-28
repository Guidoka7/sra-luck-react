-- Teste da migration_112 (agenda_registrar_levantamento). Roda num banco com a
-- estrutura de produção (QA isolado: qa/isolado) e desfaz tudo no fim.
-- psql <db-qa> -v ON_ERROR_STOP=1 -f supabase/tests/levantamento_atomico_112.sql
\set ON_ERROR_STOP on
begin;

insert into public.clientes (id, nome_completo, cpf, data_nascimento, valor_contrato, taxa_administrativa_percentual, status_revisao_financeira)
values ('b1120000-0000-4000-8000-000000000001', 'Teste 112 Fictícia', '90000112001', '1990-01-01', 10000, 20, 'pendente');

-- 1) Aprovação: decisão, responsável e UMA auditoria
select public.agenda_registrar_levantamento('b1120000-0000-4000-8000-000000000001', 'aprovada', 4500, array['pix','cartao','pix'], 4.2, 'obs livre', 'staff:teste');
do $$
declare c public.clientes%rowtype; n int;
begin
  select * into c from public.clientes where id = 'b1120000-0000-4000-8000-000000000001';
  assert c.status_revisao_financeira = 'aprovada', 'status aprovada';
  assert c.financeiro_saldo_restante = 4500 and c.financeiro_taxa_cartao = 4.2, 'saldo e taxa';
  assert c.financeiro_formas_custeio = array['pix','cartao'], 'formas sem repetição, na ordem';
  assert c.financeiro_levantamento_confirmado_por = 'staff:teste', 'responsável';
  assert c.financeiro_confirmado_em is not null, 'data de confirmação';
  select count(*) into n from public.logs_alteracoes where entidade_id = c.id and acao = 'confirmou_levantamento_financeiro' and detalhes->>'observacaoInformada' = 'true' and detalhes::text not like '%obs livre%';
  assert n = 1, 'uma auditoria sem o texto livre';
  raise notice 'OK 1 aprovação atômica';
end $$;

-- 2) Edição de levantamento aprovado preserva a data de confirmação
create temp table t112 as select financeiro_confirmado_em from public.clientes where id = 'b1120000-0000-4000-8000-000000000001';
select pg_sleep(0.01);
select public.agenda_registrar_levantamento('b1120000-0000-4000-8000-000000000001', 'aprovada', 3000, array['boleto_100'], null, null, 'staff:teste');
do $$
begin
  assert (select financeiro_confirmado_em from public.clientes where id = 'b1120000-0000-4000-8000-000000000001') = (select financeiro_confirmado_em from t112), 'data preservada';
  assert (select count(*) from public.logs_alteracoes where entidade_id = 'b1120000-0000-4000-8000-000000000001' and acao = 'editou_levantamento_financeiro') = 1, 'ação de edição';
  raise notice 'OK 2 edição preserva data';
end $$;

-- 3) Validação no banco: nada gravado quando a regra falha
do $$
declare antes text;
begin
  select row_to_json(c)::text into antes from public.clientes c where id = 'b1120000-0000-4000-8000-000000000001';
  begin
    perform public.agenda_registrar_levantamento('b1120000-0000-4000-8000-000000000001', 'aprovada', 100, array['dinheiro'], null, null, 'staff:teste');
    raise exception 'deveria ter falhado';
  exception when others then
    assert sqlerrm = 'FORMA_QUITACAO_INVALIDA', sqlerrm;
  end;
  assert (select row_to_json(c)::text from public.clientes c where id = 'b1120000-0000-4000-8000-000000000001') = antes, 'cliente intacta';
  raise notice 'OK 3 regra inválida não grava';
end $$;

-- 4) FALHA FORÇADA NA AUDITORIA: a decisão também é desfeita
create function pg_temp.falhar_auditoria() returns trigger language plpgsql as $$
begin
  if new.acao like '%levantamento%' then raise exception 'AUDITORIA_INDISPONIVEL_TESTE'; end if;
  return new;
end $$;
create trigger zz_falhar_auditoria_112 before insert on public.logs_alteracoes for each row execute function pg_temp.falhar_auditoria();
do $$
declare antes text; logs_antes int;
begin
  select row_to_json(c)::text into antes from public.clientes c where id = 'b1120000-0000-4000-8000-000000000001';
  select count(*) into logs_antes from public.logs_alteracoes where entidade_id = 'b1120000-0000-4000-8000-000000000001';
  begin
    perform public.agenda_registrar_levantamento('b1120000-0000-4000-8000-000000000001', 'recusada', 999, null, null, 'x', 'staff:teste');
    raise exception 'deveria ter falhado';
  exception when others then
    assert sqlerrm = 'AUDITORIA_INDISPONIVEL_TESTE', sqlerrm;
  end;
  assert (select row_to_json(c)::text from public.clientes c where id = 'b1120000-0000-4000-8000-000000000001') = antes, 'decisão desfeita junto com a auditoria';
  assert (select count(*) from public.logs_alteracoes where entidade_id = 'b1120000-0000-4000-8000-000000000001') = logs_antes, 'nenhuma auditoria parcial';
  raise notice 'OK 4 falha na auditoria desfaz a decisão';
end $$;
drop trigger zz_falhar_auditoria_112 on public.logs_alteracoes;

-- 5) Permissões: só service_role executa
do $$
begin
  assert not has_function_privilege('anon', 'public.agenda_registrar_levantamento(uuid,text,numeric,text[],numeric,text,text)', 'execute'), 'anon';
  assert not has_function_privilege('authenticated', 'public.agenda_registrar_levantamento(uuid,text,numeric,text[],numeric,text,text)', 'execute'), 'authenticated';
  assert has_function_privilege('service_role', 'public.agenda_registrar_levantamento(uuid,text,numeric,text[],numeric,text,text)', 'execute'), 'service_role';
  raise notice 'OK 5 execute só para service_role';
end $$;

rollback;
