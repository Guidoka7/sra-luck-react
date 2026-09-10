import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const nota = Number(body?.nota);
  const comentario = typeof body?.comentario === "string" ? body.comentario.trim().slice(0, 2000) : null;
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return NextResponse.json({ erro: "Informe uma nota de 1 a 5." }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("feedback_jornada").insert({
    cliente_id: sessao.clienteId,
    nota,
    comentario: comentario || null,
  });
  if (error) return NextResponse.json({ erro: "Não foi possível registrar seu feedback." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
