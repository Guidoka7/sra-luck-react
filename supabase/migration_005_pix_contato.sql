-- ============================================================================
-- migration_005_pix_contato.sql
--
-- Adiciona à tabela `configuracoes` (singleton) os campos de pagamento PIX
-- e contato exibidos para a cliente na área /agenda. Tudo editável pelo
-- admin em /admin/configuracoes.
-- ============================================================================

alter table configuracoes
  add column if not exists pix_chave text not null default '',
  add column if not exists pix_qrcode_base64 text not null default '',
  add column if not exists whatsapp_contato text not null default '',
  add column if not exists telefone_contato text not null default '';

comment on column configuracoes.pix_chave is 'Chave PIX exibida para a cliente copiar (CPF/CNPJ, e-mail, telefone ou aleatória).';
comment on column configuracoes.pix_qrcode_base64 is 'Imagem do QR Code do PIX, guardada como data URL base64 (ex.: data:image/png;base64,...).';
comment on column configuracoes.whatsapp_contato is 'Número de WhatsApp em formato internacional só dígitos (ex.: 5561999999999), usado no botão flutuante e no link wa.me.';
comment on column configuracoes.telefone_contato is 'Telefone de contato exibido em texto (formato livre, ex.: (61) 99999-9999).';
