import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

const HORARIOS_VALIDOS = new Set(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function adicionarDias(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const tipo = body.tipo === "cirurgia" ? "cirurgia" : "termos";
  const dataId = body.dataId as string | undefined;
  const data = body.data as string | undefined;
  const horario = body.horario as string | undefined;

  if (tipo === "termos" && (!dataId || !horario || !HORARIOS_VALIDOS.has(horario))) {
    return NextResponse.json({ erro: "Escolha a nova data e o horário da assinatura." }, { status: 400 });
  }
  if (tipo === "cirurgia" && (!data || !ISO.test(data))) {
    return NextResponse.json({ erro: "Escolha a nova data da cirurgia." }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: cliente } = await supabase.from("clientes").select("id").eq("id", sessao.clienteId).single();
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });

  const { data: agendamento } = await supabase
    .from("agendamentos")
    .select("id, data_id, horario_termos, previsao_liberacao_financeira, datas(data)")
    .eq("cliente_id", cliente.id)
    .eq("status", "confirmado")
    .maybeSingle();
  if (!agendamento) return NextResponse.json({ erro: "Não existe um agendamento confirmado para alterar." }, { status: 409 });

  let dataSolicitada: string;
  if (tipo === "termos") {
    const { data: dataAlvo } = await supabase.from("datas").select("id, data, vagas_totais, status").eq("id", dataId!).single();
    if (!dataAlvo || dataAlvo.status !== "disponivel") return NextResponse.json({ erro: "Essa data não está mais disponível." }, { status: 409 });
    const { count } = await supabase.from("agendamentos").select("id", { count: "exact", head: true }).eq("data_id", dataId!).eq("status", "confirmado").neq("id", agendamento.id);
    if ((count ?? 0) >= dataAlvo.vagas_totais) return NextResponse.json({ erro: "As vagas dessa data acabaram de se esgotar." }, { status: 409 });
    dataSolicitada = dataAlvo.data;
  } else {
    const dataAssinatura = (agendamento as any).datas?.data as string | null;
    if (!dataAssinatura) return NextResponse.json({ erro: "Não foi possível identificar a data da assinatura dos termos." }, { status: 409 });
    const primeiraDataPermitida = adicionarDias(dataAssinatura, 90);
    if (data! < primeiraDataPermitida) return NextResponse.json({ erro: `A cirurgia só pode ser agendada a partir de ${primeiraDataPermitida.split("-").reverse().join("/")}.` }, { status: 409 });
    const { data: dataAlvo } = await supabase.from("datas_liberacao_financeira").select("id, data, status").eq("data", data!).single();
    if (!dataAlvo || dataAlvo.status !== "disponivel") return NextResponse.json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, { status: 409 });
    const { count } = await supabase.from("agendamentos").select("id", { count: "exact", head: true }).eq("status", "confirmado").eq("previsao_liberacao_financeira", data!).neq("id", agendamento.id);
    if ((count ?? 0) > 0) return NextResponse.json({ erro: "Essa data acabou de ser ocupada. Escolha outra data disponível." }, { status: 409 });
    dataSolicitada = data!;
  }

  const payload = {
    cliente_id: cliente.id,
    agendamento_id: agendamento.id,
    tipo,
    data_id: tipo === "termos" ? dataId! : null,
    data_solicitada: dataSolicitada,
    horario_termos: tipo === "termos" ? horario! : null,
    status: "pendente",
    observacao: null,
    analisada_por: null,
    analisada_em: null,
    updated_at: new Date().toISOString(),
  };

  const { data: solicitacao, error } = await supabase
    .from("solicitacoes_remarcacao_agendamento")
    .upsert(payload, { onConflict: "agendamento_id,tipo" })
    .select("id, tipo, status, data_solicitada, horario_termos, created_at")
    .single();

  if (error) return NextResponse.json({ erro: `Não foi possível enviar sua solicitação de alteração: ${error.message}` }, { status: 500 });

  return NextResponse.json({
    ok: true,
    solicitacao,
    mensagem: "Sua solicitação de alteração foi enviada para análise. O prazo é de até 5 dias úteis. A agenda atual permanece inalterada até a autorização.",
  });
}
