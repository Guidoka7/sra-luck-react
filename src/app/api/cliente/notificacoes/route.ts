import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

// Central de notificações da cliente: lista as notificações (mais recentes
// primeiro) e o contador de não lidas, para o sino no cabeçalho do app.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const supabase = createServiceSupabaseClient();

  const { data: notificacoes, error } = await supabase
    .from("notificacoes_cliente")
    .select("id, tipo, titulo, mensagem, emoji, destino, lida, created_at")
    .eq("cliente_id", sessao.clienteId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const naoLidas = (notificacoes ?? []).filter((n: { lida: boolean }) => !n.lida).length;

  return NextResponse.json({ notificacoes: notificacoes ?? [], naoLidas });
}
