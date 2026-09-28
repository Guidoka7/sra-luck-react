-- Seed do QA ISOLADO LOCAL. Todos os dados são fictícios (nomes "QA", CPFs com
-- prefixo 900, e-mails @sraluck.test). Nada aqui é copiado de clientes reais.
-- Estados financeiros e de agenda são criados pelas MESMAS RPCs de produção.
\set ON_ERROR_STOP on
begin;

-- Configuração operacional (valores iguais aos de produção; contatos fictícios)
insert into public.configuracoes (id, nome_clinica, meta_orcamento_mensal, frase_sonho, whatsapp_contato, telefone_contato, pix_chave, desconto_pix_percentual, pix_desconto_percentual, agenda_liberacao_financeira_bloqueada, cirurgia_intervalo_minimo_dias)
values (1, 'Sra. Luck (QA)', 100000, 'AQUI O SEU SONHO É POSSÍVEL!!', '5561900000000', '5561900000000', 'qa-pix@sraluck.test', 0, 5, false, 90)
on conflict (id) do nothing;
insert into public.regras_operacionais (id, prazo_liberacao_dias_uteis, teto_mensal_operacional, percentual_12_24x, percentual_36x, percentual_48_72x, app_exige_parcela, app_exige_procedimento, atualizado_por)
values (1, 5, 100000, 60, 70, 80, true, false, 'seed-qa') on conflict (id) do nothing;
insert into public.clube_config (id) values (1) on conflict (id) do nothing;

-- Equipe (usuários do Auth local criados pela API admin)
insert into public.colaboradores (auth_user_id, nome, email, cargo, ativo, permissoes)
select id, 'QA Administrativo', email, 'administrativo', true, '{}' from auth.users where email = 'qa.administrativo@sraluck.test'
on conflict (auth_user_id) do nothing;
insert into public.colaboradores (auth_user_id, nome, email, cargo, ativo, permissoes)
select id, 'QA Vendedora', email, 'vendedora', true, '{}' from auth.users where email = 'qa.vendedora@sraluck.test'
on conflict (auth_user_id) do nothing;

-- Datas de termos (hoje em São Paulo + próximas semanas) e de cirurgia (a partir de +90 dias)
insert into public.datas (data, vagas_totais, status)
select d, 3, 'disponivel' from (values (0), (7), (14), (21)) v(o), lateral (select (timezone('America/Sao_Paulo', now()))::date + o d) x
on conflict (data) do nothing;
insert into public.datas_liberacao_financeira (data, vagas_totais, status)
select (timezone('America/Sao_Paulo', now()))::date + o, 2, 'disponivel' from generate_series(60, 150, 7) o
on conflict (data) do nothing;

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

-- QA-01 Ana: início do plano (3/24 pagas) — parcelas, comprovante, PDF
select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000001', 'Ana Fictícia QA Inicial', '90000000175', '1990-01-15', 24, 3, date '2026-07-10', true);
-- QA-02 Bruna: 15/24 pagas (62,5% ≥ 60%) — elegível; jornada de liberação pelo app
select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000002', 'Bruna Fictícia QA Elegivel', '90000000256', '1988-03-20', 24, 15, date '2025-07-10', true);
-- QA-03 Camila: termos hoje — equipe confirma previsão, presença e quitação
select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000003', 'Camila Fictícia QA Termos', '90000000337', '1992-05-05', 24, 16, date '2025-06-10', true);
select pg_temp.qa_ate_termos('a0000000-0000-4000-8000-000000000003', (timezone('America/Sao_Paulo', now()))::date);
-- QA-04 Daniela: termos hoje — cenário "5 dias úteis" (tempo simulado depois das ações)
select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000004', 'Daniela Fictícia QA Prazo', '90000000418', '1985-11-30', 24, 16, date '2025-06-10', true);
select pg_temp.qa_ate_termos('a0000000-0000-4000-8000-000000000004', (timezone('America/Sao_Paulo', now()))::date);
-- QA-05 Elisa: sem acesso ao app liberado (login deve ser recusado com 403)
select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000005', 'Elisa Fictícia QA SemAcesso', '90000000507', '1995-07-07', 24, 2, date '2026-08-10', false);
-- QA-06 Fernanda: abaixo do percentual (10/24 = 41,7%) — solicitação deve ser recusada
select pg_temp.qa_cliente('a0000000-0000-4000-8000-000000000006', 'Fernanda Fictícia QA Abaixo', '90000000680', '1991-09-09', 24, 10, date '2025-12-10', true);

commit;
