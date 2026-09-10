import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function getAdmin() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function PATCH(req: NextRequest) {
  const supabase = await getAdmin();
  if (!supabase) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ erro: "Template não informado." }, { status: 400 });
  const payload = {
    titulo: String(body.titulo ?? "").trim(),
    corpo: String(body.corpo ?? "").trim(),
    emoji: String(body.emoji ?? "💬").trim(),
    is_active: Boolean(body.is_active),
  };
  if (!payload.titulo || !payload.corpo) return NextResponse.json({ erro: "Título e mensagem são obrigatórios." }, { status: 400 });
  const { data, error } = await supabase.from("notificacao_templates").update(payload).eq("id", body.id).select("id, tipo, dias_referencia, titulo, corpo, emoji, is_active, updated_at").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}
