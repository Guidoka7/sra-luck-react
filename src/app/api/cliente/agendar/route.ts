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

  // A reserva e a validação de capacidade acontecem dentro de uma única
  // transação no banco, evitando overbooking em requisições concorrentes.
  const { data: agendamentoId, error: agendamentoError } = await supabase.rpc("agendar_data", {
    p_cliente_id: cliente.id,
    p_data_id: dataId,
    p_valor_contrato: cliente.valor_contrato,
    p_horario_termos: horario,
  });

  if (agendamentoError) {
    const mensagem = agendamentoError.message ?? "";
    if (mensagem.includes("DATA_INDISPONIVEL")) {
      return NextResponse.json({ erro: "Essa data não está mais disponível." }, { status: 409 });
    }
    if (mensagem.includes("CLIENTE_JA_AGENDADA")) {
      return NextResponse.json({ erro: "Você já tem uma data confirmada. Fale conosco para remarcar." }, { status: 409 });
    }
    if (mensagem.includes("VAGAS_ESGOTADAS")) {
      return NextResponse.json({ erro: "As vagas dessa data acabaram de se esgotar." }, { status: 409 });
    }
    console.error("Falha ao confirmar agendamento:", agendamentoError);
    return NextResponse.json({ erro: "Não foi possível confirmar sua data. Tente novamente." }, { status: 500 });
  }

  const { data: dataAlvo } = await supabase
    .from("datas")
    .select("id, data")
    .eq("id", dataId)
    .single();

  await supabase.from("solicitacoes_liberacao_financeira").update({ agendamento_id: agendamentoId }).eq("cliente_id", cliente.id).in("status", ["pendente", "em_analise", "aprovada"]).is("agendamento_id", null);

  try {
    await supabase.channel("agenda-clientes").send({
      type: "broadcast",
      event: "datas_atualizadas",
      payload: {
        acao: "agendamento_confirmado",
        data: dataAlvo?.data,
        dataId,
        clienteId: cliente.id,
        agendamentoId,
        horario,
      },
    });
  } catch (erroBroadcast) {
    console.error("Falha ao publicar atualização do agendamento:", erroBroadcast);
  }

  return NextResponse.json({ ok: true, agendamentoId, data: dataAlvo?.data, horario });
}
