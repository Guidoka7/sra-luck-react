-- QA-08 Helena: elegível (15/24) e com liberação solicitada — reteste do levantamento com auditoria.
\set ON_ERROR_STOP on
begin;
-- Cria cliente fictícia com plano de N parcelas (RPC de produção) e K pagas (baixa manual autoritativa)
create or replace function pg_temp.qa_cliente(p_id uuid, p_nome text, p_cpf text, p_nasc date, p_parcelas int, p_pagas int, p_primeiro date, p_acesso boolean)
returns void language plpgsql as $$
declare b record;
begin
  insert into public.clientes (id, nome_completo, cpf, data_nascimento, telefone, email, procedimento, valor_contrato,
    taxa_administrativa_percentual, acesso_app_liberado, acesso_app_liberado_em, status_plano, banco, origem_cadastro)
  values (p_id, p_nome, p_cpf, p_nasc, '5561900000000', lower(replace(split_part(p_nome,' ',2),'í','i')) || '.qa@sraluck.test', 'Procedimento QA',
    10000, 20, p_acesso, case when p_acesso then now() end, 'Ativa', 'Banco QA', 'manual');
  perform public.gerar_boletos_cliente(p_id, p_parcelas, 20, p_primeiro);
  for b in select id, data_vencimento from public.boletos where cliente_id = p_id and numero_parcela <= p_pagas order by numero_parcela loop
    perform public.financeiro_baixar_boleto(b.id, b.data_vencimento, 0, 0, 0, 'pix', 'Conta QA', 'seed QA', 'admin:seed-qa', 'seed-qa-' || b.id);
  end loop;
end $$;

select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000008', 'Helena Fictícia QA Reteste', '90000000841', '1987-04-04', 24, 15, date '2025-07-10', true);
select public.cliente_solicitar_liberacao_financeira('a0000000-0000-4000-8000-000000000008');
commit;
