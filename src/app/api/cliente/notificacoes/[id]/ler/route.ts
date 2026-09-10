import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

// Marca uma notificação como lida (chamado quando a cliente clica nela).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = createServiceSupabaseClient();

  // Só marca como lida se a notificação pertencer mesmo à cliente da sessão.
  const { data, error } = await supabase
    .from("notificacoes_cliente")
    .update({ lida: true })
    .eq("id", params.id)
    .eq("cliente_id", sessao.clienteId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ erro: "Notificação não encontrada." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
