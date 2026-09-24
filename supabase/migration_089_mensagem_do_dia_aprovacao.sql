-- 089 — Mensagem diária do Gemini exige aprovação humana antes de publicar.
--
-- A rotina agendada passa a preparar uma candidata em vez de publicá-la
-- automaticamente. O app continua lendo apenas status = 'pronta'.
--
-- Estados:
--   gerando                reserva/execução em andamento;
--   aguardando_aprovacao   candidata válida do Gemini, ainda não publicada;
--   pronta                 mensagem aprovada/publicada para o app;
--   falha_geracao          Gemini/configuração falhou; nada foi publicado.
--
-- Não destrutiva. Registros existentes em 'pronta' continuam válidos.

alter table public.mensagens_do_dia
  drop constraint if exists mensagens_do_dia_status_check;

alter table public.mensagens_do_dia
  add constraint mensagens_do_dia_status_check
  check (status in ('gerando', 'aguardando_aprovacao', 'pronta', 'falha_geracao'));

alter table public.mensagens_do_dia
  drop constraint if exists mensagens_do_dia_pronta_tem_texto;

alter table public.mensagens_do_dia
  add constraint mensagens_do_dia_publicavel_tem_texto
  check (
    status in ('gerando', 'falha_geracao')
    or (texto is not null and tema is not null and origem is not null)
  );

alter table public.mensagens_do_dia
  add column if not exists erro text
  check (erro is null or char_length(erro) <= 500);
