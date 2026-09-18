alter table public.boletos
  add column if not exists comprovante_enviado_em timestamptz;

update public.boletos
set comprovante_enviado_em = coalesce(comprovante_enviado_em, updated_at, created_at)
where comprovante_url is not null
  and comprovante_enviado_em is null;

create index if not exists boletos_comprovante_pendente_data_idx
  on public.boletos (comprovante_enviado_em desc)
  where status = 'pendente_confirmacao' and comprovante_url is not null;

comment on column public.boletos.comprovante_enviado_em is
  'Data/hora original do envio do comprovante pela cliente/admin. Preservada após confirmação ou recusa e usada pela fila Financeiro > Comprovantes.';
