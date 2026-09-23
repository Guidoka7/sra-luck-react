-- ============================================================================
-- MIGRATION 078: leitor de carnês — importação transacional e idempotente
--
-- O leitor (src/lib/leitor-carne + src/features/leitor-carne) roda no
-- navegador: texto nativo do PDF, OCR local e parser determinístico. Nada é
-- gravado sem revisão humana. Depois do "Confirmar importação" o Worker
-- valida tudo de novo e chama carne_importar_parcelas(), que aplica os itens
-- aprovados numa única transação:
--
--   criar      → nova parcela (nao_pago, origem 'externo') com o boleto anexado
--   anexar     → anexa o boleto a uma parcela existente SEM boleto
--                (nunca altera valor, vencimento, status ou origem)
--   substituir → troca o arquivo de uma parcela que já tinha boleto, por
--                escolha explícita (parcelas pagas/em conferência não)
--   ignorar    → só registrado no histórico da importação
--
-- Idempotência: a mesma chave devolve o mesmo resultado sem reaplicar. O
-- mesmo arquivo (SHA-256) não é importado duas vezes para a mesma cliente sem
-- confirmação explícita. Um lock por cliente evita importações concorrentes.
--
-- Privacidade: não guarda CPF, nome, texto do OCR nem linha digitável em
-- log; carne_importacoes guarda só metadados, contagens e códigos de alerta.
-- A linha digitável fica apenas em boletos.identificador_externo (onde o
-- sistema já a guardava) para o app da cliente copiar o código.
--
-- Migration aditiva. Rollback no final do arquivo.
-- ============================================================================

begin;

create table if not exists public.carne_importacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  chave_idempotencia text not null,
  arquivo_sha256 text not null check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  arquivo_nome text,
  arquivo_tipo text not null check (arquivo_tipo in ('application/pdf', 'image/jpeg', 'image/png')),
  arquivo_tamanho bigint check (arquivo_tamanho is null or arquivo_tamanho >= 0),
  paginas integer check (paginas is null or paginas >= 0),
  tipo_documento text check (tipo_documento in ('PDF_TEXT', 'PDF_SCANNED', 'IMAGE', 'MIXED_PDF')),
  parser text,
  layout_fingerprint text,
  banco text,
  confianca_documento numeric(5,4),
  nivel_confianca text check (nivel_confianca in ('ALTA', 'MEDIA', 'BAIXA')),
  alertas text[] not null default '{}',
  metricas jsonb not null default '{}'::jsonb,
  itens jsonb not null default '[]'::jsonb,
  resultado jsonb not null default '{}'::jsonb,
  status text not null default 'concluida' check (status in ('concluida')),
  cpf_divergente_confirmado boolean not null default false,
  criado_por text not null,
  created_at timestamptz not null default now(),
  constraint carne_importacoes_chave_unica unique (chave_idempotencia)
);

create index if not exists idx_carne_importacoes_cliente_sha
  on public.carne_importacoes (cliente_id, arquivo_sha256);

alter table public.carne_importacoes enable row level security;
revoke all on table public.carne_importacoes from public, anon, authenticated;
grant all on table public.carne_importacoes to service_role;

-- ----------------------------------------------------------------------------
-- Importação atômica.
-- p_documento: { sha256, nome, tipo, tamanho, paginas, tipoDocumento, parser,
--   fingerprint, banco, confianca, nivel, alertas[], metricas{},
--   permitirReimportacao, cpfDivergenteConfirmado }
-- p_itens: [{ item, acao, boletoId?, numero?, total?, vencimento?,
--   valorCentavos?, arquivoPath?, identificador?, corrigidos[] }]
-- ----------------------------------------------------------------------------
create or replace function public.carne_importar_parcelas(
  p_cliente_id uuid,
  p_chave text,
  p_documento jsonb,
  p_itens jsonb,
  p_usuario text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existente public.carne_importacoes%rowtype;
  v_item jsonb;
  v_acao text;
  v_boleto public.boletos%rowtype;
  v_numero integer;
  v_total integer;
  v_total_cliente integer;
  v_vencimento date;
  v_centavos bigint;
  v_path text;
  v_prefixo text;
  v_ident text;
  v_banco text := nullif(trim(coalesce(p_documento->>'banco', '')), '');
  v_novo_id uuid;
  v_resultado jsonb := '[]'::jsonb;
  v_criadas integer := 0;
  v_anexadas integer := 0;
  v_substituidas integer := 0;
  v_ignoradas integer := 0;
  v_importacao_id uuid;
  v_sha text := lower(coalesce(p_documento->>'sha256', ''));
begin
  if p_chave is null or length(p_chave) < 16 then raise exception 'CHAVE_IDEMPOTENCIA_INVALIDA'; end if;
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'ARQUIVO_HASH_INVALIDO'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'SEM_ITENS'; end if;
  if jsonb_array_length(p_itens) > 400 then raise exception 'ITENS_DEMAIS'; end if;

  -- Uma importação por cliente por vez.
  perform pg_advisory_xact_lock(hashtextextended('carne_importar:' || p_cliente_id::text, 0));

  if not exists (select 1 from public.clientes where id = p_cliente_id and arquivado_em is null) then
    raise exception 'CLIENTE_NAO_ENCONTRADA';
  end if;

  -- Idempotência: mesma chave → mesmo resultado, nada reaplicado.
  select * into v_existente from public.carne_importacoes where chave_idempotencia = p_chave;
  if found then
    if v_existente.cliente_id <> p_cliente_id or v_existente.arquivo_sha256 <> v_sha then
      raise exception 'CHAVE_IDEMPOTENCIA_CONFLITANTE';
    end if;
    return v_existente.resultado || jsonb_build_object('repetida', true);
  end if;

  if not coalesce((p_documento->>'permitirReimportacao')::boolean, false)
     and exists (select 1 from public.carne_importacoes where cliente_id = p_cliente_id and arquivo_sha256 = v_sha) then
    raise exception 'DOCUMENTO_JA_IMPORTADO';
  end if;

  v_prefixo := 'carnes/' || p_cliente_id::text || '/' || v_sha || '/';
  select max(total_parcelas) into v_total_cliente from public.boletos where cliente_id = p_cliente_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_acao := v_item->>'acao';
    v_path := v_item->>'arquivoPath';
    v_ident := nullif(regexp_replace(coalesce(v_item->>'identificador', ''), '\D', '', 'g'), '');
    if v_ident is not null and length(v_ident) not in (44, 47, 48) then raise exception 'IDENTIFICADOR_INVALIDO:%', v_item->>'item'; end if;

    if v_acao = 'ignorar' then
      v_ignoradas := v_ignoradas + 1;
      v_resultado := v_resultado || jsonb_build_object('item', v_item->>'item', 'acao', 'ignorar');
      continue;
    end if;

    if v_acao not in ('criar', 'anexar', 'substituir') then raise exception 'ACAO_INVALIDA:%', v_item->>'item'; end if;
    if v_path is null or left(v_path, length(v_prefixo)) <> v_prefixo or v_path ~ '\.\.' then
      raise exception 'ARQUIVO_INVALIDO:%', v_item->>'item';
    end if;

    if v_acao = 'criar' then
      if coalesce(v_item->>'numero', '') !~ '^\d{1,4}$' or coalesce(v_item->>'total', '') !~ '^\d{1,4}$' then raise exception 'PARCELA_INVALIDA:%', v_item->>'item'; end if;
      v_numero := (v_item->>'numero')::integer;
      v_total := (v_item->>'total')::integer;
      if v_numero < 1 or v_total < 1 or v_numero > v_total then raise exception 'PARCELA_INVALIDA:%', v_item->>'item'; end if;
      if v_total_cliente is not null and v_total <> v_total_cliente then raise exception 'TOTAL_CONFLITANTE:%', v_item->>'item'; end if;
      if coalesce(v_item->>'vencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'VENCIMENTO_OBRIGATORIO:%', v_item->>'item'; end if;
      v_vencimento := (v_item->>'vencimento')::date;
      if coalesce(v_item->>'valorCentavos', '') !~ '^\d{1,10}$' then raise exception 'VALOR_OBRIGATORIO:%', v_item->>'item'; end if;
      v_centavos := (v_item->>'valorCentavos')::bigint;
      if v_centavos <= 0 then raise exception 'VALOR_OBRIGATORIO:%', v_item->>'item'; end if;
      if exists (select 1 from public.boletos where cliente_id = p_cliente_id and numero_parcela = v_numero) then
        raise exception 'PARCELA_JA_EXISTE:%', v_numero;
      end if;

      insert into public.boletos (cliente_id, numero_parcela, total_parcelas, valor, data_vencimento, status, boleto_url, identificador_externo, instituicao_financeira, origem_boleto)
      values (p_cliente_id, v_numero, v_total, round(v_centavos::numeric / 100, 2), v_vencimento, 'nao_pago', v_path, v_ident, v_banco, 'externo')
      returning id into v_novo_id;
      v_total_cliente := coalesce(v_total_cliente, v_total);
      v_criadas := v_criadas + 1;
      v_resultado := v_resultado || jsonb_build_object('item', v_item->>'item', 'acao', 'criar', 'boletoId', v_novo_id, 'numero', v_numero);
    else
      if coalesce(v_item->>'boletoId', '') !~ '^[0-9a-f-]{36}$' then raise exception 'PARCELA_INVALIDA:%', v_item->>'item'; end if;
      select * into v_boleto from public.boletos where id = (v_item->>'boletoId')::uuid and cliente_id = p_cliente_id for update;
      if not found then raise exception 'PARCELA_NAO_ENCONTRADA:%', v_item->>'item'; end if;

      if v_acao = 'anexar' then
        if v_boleto.boleto_url is not null then raise exception 'PARCELA_JA_TEM_BOLETO:%', v_boleto.numero_parcela; end if;
        v_anexadas := v_anexadas + 1;
      else
        if v_boleto.boleto_url is null then raise exception 'PARCELA_SEM_BOLETO:%', v_boleto.numero_parcela; end if;
        if v_boleto.status in ('pago', 'pendente_confirmacao') then raise exception 'PARCELA_PAGA_OU_EM_CONFERENCIA:%', v_boleto.numero_parcela; end if;
        v_substituidas := v_substituidas + 1;
      end if;

      -- Só o documento do boleto muda: valor, vencimento, status e origem ficam como estão.
      update public.boletos
      set boleto_url = v_path,
          identificador_externo = coalesce(v_ident, case when v_acao = 'anexar' then identificador_externo end),
          instituicao_financeira = coalesce(instituicao_financeira, v_banco),
          updated_at = now()
      where id = v_boleto.id;
      v_resultado := v_resultado || jsonb_build_object('item', v_item->>'item', 'acao', v_acao, 'boletoId', v_boleto.id, 'numero', v_boleto.numero_parcela);
    end if;
  end loop;

  insert into public.carne_importacoes (
    cliente_id, chave_idempotencia, arquivo_sha256, arquivo_nome, arquivo_tipo, arquivo_tamanho, paginas,
    tipo_documento, parser, layout_fingerprint, banco, confianca_documento, nivel_confianca, alertas, metricas,
    itens, resultado, cpf_divergente_confirmado, criado_por
  ) values (
    p_cliente_id, p_chave, v_sha, left(p_documento->>'nome', 200), p_documento->>'tipo',
    nullif(p_documento->>'tamanho', '')::bigint, nullif(p_documento->>'paginas', '')::integer,
    p_documento->>'tipoDocumento', left(p_documento->>'parser', 60), left(p_documento->>'fingerprint', 60), v_banco,
    nullif(p_documento->>'confianca', '')::numeric, p_documento->>'nivel',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_documento->'alertas', '[]'::jsonb))), '{}'),
    coalesce(p_documento->'metricas', '{}'::jsonb),
    -- Itens sem identificador (a linha digitável fica só na parcela).
    (select coalesce(jsonb_agg(i - 'identificador'), '[]'::jsonb) from jsonb_array_elements(p_itens) i),
    '{}'::jsonb,
    coalesce((p_documento->>'cpfDivergenteConfirmado')::boolean, false),
    p_usuario
  ) returning id into v_importacao_id;

  v_resultado := jsonb_build_object(
    'importacaoId', v_importacao_id,
    'criadas', v_criadas, 'anexadas', v_anexadas, 'substituidas', v_substituidas, 'ignoradas', v_ignoradas,
    'itens', v_resultado
  );
  update public.carne_importacoes set resultado = v_resultado where id = v_importacao_id;

  insert into public.logs_alteracoes (usuario, acao, entidade, entidade_id, detalhes)
  values (p_usuario, 'importou_carne_leitor', 'clientes', p_cliente_id, jsonb_build_object(
    'importacaoId', v_importacao_id, 'tipo', p_documento->>'tipo', 'paginas', p_documento->'paginas',
    'criadas', v_criadas, 'anexadas', v_anexadas, 'substituidas', v_substituidas, 'ignoradas', v_ignoradas,
    'cpfDivergenteConfirmado', coalesce((p_documento->>'cpfDivergenteConfirmado')::boolean, false)
  ));

  return v_resultado;
end;
$$;

revoke all on function public.carne_importar_parcelas(uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.carne_importar_parcelas(uuid, text, jsonb, jsonb, text) to service_role;

commit;

-- ----------------------------------------------------------------------------
-- Rollback (não apaga parcelas criadas; os arquivos continuam no bucket):
--   begin;
--   drop function if exists public.carne_importar_parcelas(uuid, text, jsonb, jsonb, text);
--   drop table if exists public.carne_importacoes;
--   commit;
-- ----------------------------------------------------------------------------
