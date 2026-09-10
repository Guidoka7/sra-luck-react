import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const HORARIOS_VALIDOS = new Set(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const body = await req.json();
  const dataId = body.dataId as string | undefined;
  const horario = body.horario as string | undefined;
  if (!dataId || !horario || !HORARIOS_VALIDOS.has(horario)) return NextResponse.json({ erro: "Escolha a data e o horário da assinatura." }, { status: 400 });
  const supabase = createServiceSupabaseClient();

  const { data: cliente } = await supabase.from("clientes").select("id, valor_contrato").eq("id", sessao.clienteId).single();
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });

  const { data: jaTem } = await supabase.from("agendamentos").select("id").eq("cliente_id", cliente.id).eq("status", "confirmado").maybeSingle();
  if (jaTem) return NextResponse.json({ erro: "Você já tem uma data confirmada. Fale conosco para remarcar." }, { status: 409 });

  const { data: dataAlvo } = await supabase.from("datas").select("id, data, vagas_totais, status").eq("id", dataId).single();
  if (!dataAlvo || dataAlvo.status !== "disponivel") return NextResponse.json({ erro: "Essa data não está mais disponível." }, { status: 409 });

  const { count } = await supabase.from("agendamentos").select("id", { count: "exact", head: true }).eq("data_id", dataId).eq("status", "confirmado");
  if ((count ?? 0) >= dataAlvo.vagas_totais) return NextResponse.json({ erro: "As vagas dessa data acabaram de se esgotar." }, { status: 409 });

  const { data: novoAgendamento, error } = await supabase.from("agendamentos").insert({ cliente_id: cliente.id, data_id: dataId, valor_contrato: cliente.valor_contrato, status: "confirmado", horario_termos: horario }).select("id").single();
  if (error) return NextResponse.json({ erro: "Não foi possível confirmar sua data. Tente novamente." }, { status: 500 });

  await supabase.from("solicitacoes_liberacao_financeira").update({ agendamento_id: novoAgendamento.id }).eq("cliente_id", cliente.id).in("status", ["pendente", "em_analise", "aprovada"]).is("agendamento_id", null);

  try {
    await supabase.channel("agenda-clientes").send({ type: "broadcast", event: "datas_atualizadas", payload: { acao: "agendamento_confirmado", data: dataAlvo.data, dataId: dataAlvo.id, clienteId: cliente.id, agendamentoId: novoAgendamento.id, horario } });
  } catch (erroBroadcast) {
    console.error("Falha ao publicar atualização do agendamento:", erroBroadcast);
  }

  return NextResponse.json({ ok: true, agendamentoId: novoAgendamento.id, data: dataAlvo.data, horario });
}
