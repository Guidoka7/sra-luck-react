import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json();
  const atualizacoes: Record<string, unknown> = {};
  if (body.status !== undefined) atualizacoes.status = body.status;

  const { data, error } = await supabase
    .from("datas_liberacao_financeira")
    .update(atualizacoes)
    .eq("id", params.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "editou_data_liberacao_financeira",
    entidade: "datas_liberacao_financeira",
    entidade_id: params.id,
    detalhes: atualizacoes,
  });

  return NextResponse.json({ data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { error } = await supabase.from("datas_liberacao_financeira").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "removeu_data_liberacao_financeira",
    entidade: "datas_liberacao_financeira",
    entidade_id: params.id,
    detalhes: {},
  });

  return NextResponse.json({ ok: true });
}
