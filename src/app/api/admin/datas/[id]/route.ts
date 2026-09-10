import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const CANAL_AGENDA_CLIENTES = "agenda-clientes";

async function publicarAtualizacaoAgenda(payload: Record<string, unknown>) {
  try {
    const serviceClient = createServiceSupabaseClient();
    await serviceClient.channel(CANAL_AGENDA_CLIENTES).send({ type: "broadcast", event: "datas_atualizadas", payload });
  } catch (erro) {
    console.error("Falha ao publicar atualização da agenda em tempo real:", erro);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json();
  const atualizacoes: Record<string, unknown> = {};
  if (body.vagasTotais !== undefined) atualizacoes.vagas_totais = Number(body.vagasTotais);
  if (body.status !== undefined) atualizacoes.status = body.status;

  const { data, error } = await supabase.from("datas").update(atualizacoes).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

  await supabase.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: "editou_data", entidade: "datas", entidade_id: params.id, detalhes: atualizacoes });
  await publicarAtualizacaoAgenda({ acao: "atualizada", data: data.data, dataId: data.id });

  return NextResponse.json({ data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const { data: existente } = await supabase.from("datas").select("id, data").eq("id", params.id).single();
  const { error } = await supabase.from("datas").delete().eq("id", params.id);
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

  await supabase.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: "removeu_data", entidade: "datas", entidade_id: params.id, detalhes: {} });
  await publicarAtualizacaoAgenda({ acao: "removida", data: existente?.data ?? null, dataId: params.id });

  return NextResponse.json({ ok: true });
}
