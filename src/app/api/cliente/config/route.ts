import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

/**
 * Expõe para a área da cliente SOMENTE os campos de `configuracoes` que são
 * seguros de mostrar (chave PIX, QR Code e contato). Campos administrativos
 * como meta_orcamento_mensal nunca passam por aqui.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("configuracoes")
    .select(
      "nome_clinica, pix_chave, pix_qrcode_base64, pix_desconto_percentual, whatsapp_contato, telefone_contato"
    )
    .eq("id", 1)
    .single();

  if (error || !data) {
    return NextResponse.json({ erro: "Não foi possível carregar as configurações." }, { status: 500 });
  }

  return NextResponse.json({
    nomeClinica: data.nome_clinica,
    pagamento: {
      pixChave: data.pix_chave || null,
      pixQrCodeUrl: data.pix_qrcode_base64 || null,
      pixDescontoPercentual: data.pix_desconto_percentual || 0,
    },
    contato: {
      whatsapp: data.whatsapp_contato || null,
      telefone: data.telefone_contato || null,
    },
  });
}
