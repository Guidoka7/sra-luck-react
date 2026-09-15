-- ============================================================================
-- MIGRATION 051: Corrigir FK legada de notificacao_logs.notificacao_id
-- ============================================================================
-- A migration 006 criou notificacao_logs.notificacao_id apontando para
-- notificacao_agendadas(id) — tabela de um sistema externo de disparo
-- agendado que nunca foi adotado pelo runtime atual (worker/*.ts não
-- referencia notificacao_agendadas em nenhum lugar).
--
-- worker/admin-notificacoes.ts (registrarNotificacao) grava a notificação
-- em notificacoes_cliente (migration 010) e tenta linkar o log a esse id.
-- Como a FK nunca foi atualizada, todo insert em notificacao_logs que
-- referencia um id real de notificacoes_cliente viola a constraint e falha
-- silenciosamente (o erro só vai para console.error do Worker) — por isso
-- push_status/erro_mensagem nunca refletem o resultado real do envio push.

alter table public.notificacao_logs
  drop constraint if exists notificacao_logs_notificacao_id_fkey;

alter table public.notificacao_logs
  add constraint notificacao_logs_notificacao_id_fkey
  foreign key (notificacao_id) references public.notificacoes_cliente(id);

select 'notificacao_logs.notificacao_id agora referencia notificacoes_cliente' as mensagem;
