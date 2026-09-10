import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const supabase = createServiceSupabaseClient();

  const { data: agendamento, error: erroAgendamento } = await supabase
    .from("agendamentos")
    .select("id, cliente_id, previsao_liberacao_financeira")
    .eq("id", params.id)
    .single();
  if (erroAgendamento || !agendamento) return NextResponse.json({ erro: "Agendamento não encontrado." }, { status: 404 });

  const { data: cliente, error: erroCliente } = await supabase
    .from("clientes")
    .select("id, nome_completo, status_cirurgia, status_financeiro, custeio_confirmado_em")
    .eq("id", agendamento.cliente_id)
    .single();
  if (erroCliente || !cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });

  const updates: Record<string, unknown> = {};
  const detalhes: Record<string, unknown> = {};

  if (typeof body.custeioConfirmado === "boolean") {
    updates.custeio_confirmado_em = body.custeioConfirmado ? new Date().toISOString() : null;
    if (body.custeioConfirmado) updates.status_financeiro = "pago";
    detalhes.custeioConfirmado = body.custeioConfirmado;
  }

  if (typeof body.cirurgiaRealizada === "boolean") {
    updates.status_cirurgia = body.cirurgiaRealizada ? "realizada" : "agendada";
    detalhes.cirurgiaRealizada = body.cirurgiaRealizada;
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ erro: "Nenhuma confirmação informada." }, { status: 400 });

  const { data: atualizado, error } = await supabase
    .from("clientes")
    .update(updates)
    .eq("id", cliente.id)
    .select("id, nome_completo, status_cirurgia, status_financeiro, custeio_confirmado_em")
    .single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  await supabase.from("logs_alteracoes").insert({
    usuario: user.email ?? "admin",
    acao: "atualizou_ciclo_liberacao",
    entidade: "clientes",
    entidade_id: cliente.id,
    detalhes: { ...detalhes, agendamento_id: params.id, previsao_liberacao_financeira: agendamento.previsao_liberacao_financeira },
  });

  try {
    await supabase.channel(`notificacoes-cliente:${cliente.id}`).send({
      type: "broadcast",
      event: "nova_notificacao",
      payload: { tipo: "ciclo_liberacao_atualizado", clienteId: cliente.id },
    });
  } catch {}

  return NextResponse.json({ cliente: atualizado, concluido: Boolean(atualizado.custeio_confirmado_em) && atualizado.status_cirurgia === "realizada" });
}
