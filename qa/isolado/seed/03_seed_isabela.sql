-- QA-09 Isabela: termos hoje — cenário de AUSÊNCIA (não compareceu).
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

-- Leva a cliente até termos agendados em p_data (levantamento → solicitação → forma → agendar_data)
create or replace function pg_temp.qa_ate_termos(p_id uuid, p_data date) returns uuid language plpgsql as $$
declare v_data uuid; v_ag uuid;
begin
  perform public.agenda_confirmar_levantamento(p_id, 2000, array['pix'], 'admin:seed-qa');
  perform public.cliente_solicitar_liberacao_financeira(p_id);
  insert into public.solicitacoes_liberacao_financeira (cliente_id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa)
  values (p_id, 'pix', 2000, 0, 2000);
  select id into v_data from public.datas where data = p_data;
  v_ag := public.agendar_data(p_id, v_data, 10000, '10:00');
  return v_ag;
end $$;

select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000009', 'Isabela Fictícia QA Ausente', '90000000922', '1994-06-06', 24, 16, date '2025-06-10', true);
select pg_temp.qa_ate_termos('a0000000-0000-4000-8000-000000000009', (timezone('America/Sao_Paulo', now()))::date);
commit;
