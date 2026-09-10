import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const BUCKET = "boletos-clientes";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseAuth = createServerSupabaseClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const supabase = createServiceSupabaseClient();
  const { data: boleto } = await supabase
    .from("boletos")
    .select("comprovante_url")
    .eq("id", params.id)
    .single();

  if (!boleto?.comprovante_url) {
    return NextResponse.json({ erro: "Comprovante não encontrado." }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(boleto.comprovante_url, 60 * 5);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ erro: "Não foi possível gerar o link do comprovante." }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
