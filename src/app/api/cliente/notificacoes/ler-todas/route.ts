import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

// Marca todas as notificações pendentes da cliente como lidas de uma vez.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = createServiceSupabaseClient();

  const { error } = await supabase
    .from("notificacoes_cliente")
    .update({ lida: true })
    .eq("cliente_id", sessao.clienteId)
    .eq("lida", false);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
