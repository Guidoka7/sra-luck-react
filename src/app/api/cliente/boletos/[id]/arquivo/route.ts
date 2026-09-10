import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const BUCKET = "boletos-clientes";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = createServiceSupabaseClient();

  const { data: boleto } = await supabase
    .from("boletos")
    .select("cliente_id, boleto_url")
    .eq("id", params.id)
    .single();

  if (!boleto || boleto.cliente_id !== sessao.clienteId || !boleto.boleto_url) {
    return NextResponse.json({ erro: "Boleto ainda não disponível." }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(boleto.boleto_url, 60 * 5); // 5 minutos

  if (error || !data?.signedUrl) {
    return NextResponse.json({ erro: "Não foi possível gerar o link do boleto." }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
