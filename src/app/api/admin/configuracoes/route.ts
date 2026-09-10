import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("configuracoes")
    .select(
      "id, nome_clinica, meta_orcamento_mensal, frase_sonho, pix_chave, pix_qrcode_base64, pix_desconto_percentual, whatsapp_contato, telefone_contato, agenda_liberacao_financeira_bloqueada, updated_at"
    )
    .eq("id", 1)
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ configuracoes: data });
}

// Valores predefinidos que o admin pode escolher para o desconto PIX
// (incide apenas sobre juros + multa, nunca sobre o valor original da parcela).
const DESCONTOS_PIX_PERMITIDOS = [0, 5, 10, 15, 20, 25, 30];

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const body = await req.json();
  const atualizacoes: Record<string, unknown> = {};

  if (body.nomeClinica !== undefined) atualizacoes.nome_clinica = body.nomeClinica;
  if (body.metaOrcamentoMensal !== undefined) {
    atualizacoes.meta_orcamento_mensal = Number(body.metaOrcamentoMensal) || 0;
  }
  if (body.fraseSonho !== undefined) atualizacoes.frase_sonho = body.fraseSonho;

  if (body.pixChave !== undefined) atualizacoes.pix_chave = String(body.pixChave).trim();

  if (body.pixQrCodeBase64 !== undefined) {
    const valor = String(body.pixQrCodeBase64).trim();
    if (valor && !valor.startsWith("data:image/")) {
      return NextResponse.json(
        { erro: "QR Code inválido. Envie uma imagem (PNG ou JPG)." },
        { status: 400 }
      );
    }
    // ~1.5MB de imagem já vira ~2MB em base64 — limite generoso pra um QR code.
    if (valor.length > 2_500_000) {
      return NextResponse.json(
        { erro: "Imagem do QR Code muito grande. Use um arquivo menor que 1.5MB." },
        { status: 400 }
      );
    }
    atualizacoes.pix_qrcode_base64 = valor;
  }

  if (body.whatsappContato !== undefined) {
    const digitos = String(body.whatsappContato).replace(/\D/g, "");
    if (digitos && (digitos.length < 10 || digitos.length > 14)) {
      return NextResponse.json(
        { erro: "Número de WhatsApp inválido. Use o formato com DDI, ex.: 5561999999999." },
        { status: 400 }
      );
    }
    atualizacoes.whatsapp_contato = digitos;
  }

  if (body.telefoneContato !== undefined) {
    atualizacoes.telefone_contato = String(body.telefoneContato).trim();
  }

  if (body.pixDescontoPercentual !== undefined) {
    const percentual = Number(body.pixDescontoPercentual);
    if (!DESCONTOS_PIX_PERMITIDOS.includes(percentual)) {
      return NextResponse.json(
        { erro: "Desconto PIX inválido. Escolha um dos percentuais disponíveis." },
        { status: 400 }
      );
    }
    atualizacoes.pix_desconto_percentual = percentual;
  }

  if (body.agendaLiberacaoFinanceiraBloqueada !== undefined) {
    atualizacoes.agenda_liberacao_financeira_bloqueada = Boolean(body.agendaLiberacaoFinanceiraBloqueada);
  }

  if (Object.keys(atualizacoes).length === 0) {
    return NextResponse.json({ erro: "Nenhuma alteração enviada." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("configuracoes")
    .update(atualizacoes)
    .eq("id", 1)
    .select(
      "id, nome_clinica, meta_orcamento_mensal, frase_sonho, pix_chave, pix_qrcode_base64, pix_desconto_percentual, whatsapp_contato, telefone_contato, agenda_liberacao_financeira_bloqueada, updated_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 400 });
  }

  // Evita gravar o base64 inteiro do QR Code no log de alterações.
  const detalhesLog = { ...atualizacoes };
  if (typeof detalhesLog.pix_qrcode_base64 === "string") {
    detalhesLog.pix_qrcode_base64 = detalhesLog.pix_qrcode_base64
      ? "[imagem atualizada]"
      : "[imagem removida]";
  }

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "editou_configuracoes",
    entidade: "configuracoes",
    entidade_id: "1",
    detalhes: detalhesLog,
  });

  return NextResponse.json({ configuracoes: data });
}
