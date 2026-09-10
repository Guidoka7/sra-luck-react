import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

function agoraSaoPaulo() {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return { data: `${get("year")}-${get("month")}-${get("day")}`, hora: `${get("hour")}:${get("minute")}` };
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const { data, error } = await supabase.from("agendamentos")
    .select("id, cliente_id, status, horario_termos, termos_assinados_em, created_at, valor_contrato, clientes(id, nome_completo, cpf, status_revisao_financeira, status_financeiro, status_cirurgia, financeiro_saldo_restante, financeiro_formas_custeio), datas!inner(data)")
    .eq("status", "confirmado").order("data", { ascending: true, foreignTable: "datas" }).order("horario_termos", { ascending: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const hoje = agoraSaoPaulo();
  const agendamentos = (data ?? []).map((a: any) => {
    const cliente = Array.isArray(a.clientes) ? a.clientes[0] : a.clientes;
    const dataAgendada = a.datas?.data ?? null;
    const horario = a.horario_termos ? String(a.horario_termos).slice(0, 5) : null;
    const ehHoje = dataAgendada === hoje.data;
    return { id: a.id, clienteId: a.cliente_id, nome: cliente?.nome_completo ?? "Cliente sem nome", cpf: cliente?.cpf ?? null, data: dataAgendada, horario, criadoEm: a.created_at, statusRevisaoFinanceira: cliente?.status_revisao_financeira ?? null, statusFinanceiro: cliente?.status_financeiro ?? null, statusCirurgia: cliente?.status_cirurgia ?? null, valorContrato: a.valor_contrato, saldoRestante: cliente?.financeiro_saldo_restante ?? null, formasCusteio: cliente?.financeiro_formas_custeio ?? [], podeConfirmarAssinatura: ehHoje && (!horario || hoje.hora >= horario), ehHoje };
  });
  return NextResponse.json({ agendamentos, hoje });
}

export async function POST(req: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const body = await req.json();
  if (!body.id) return NextResponse.json({ erro: "Agendamento não informado." }, { status: 400 });
  const service = createServiceSupabaseClient();
  const { data: agendamento } = await service.from("agendamentos").select("id, cliente_id, status, horario_termos, termos_assinados_em, datas!inner(data)").eq("id", body.id).single();
  if (!agendamento || agendamento.status !== "confirmado") return NextResponse.json({ erro: "Este agendamento não está mais pendente de assinatura." }, { status: 409 });
  const agora = agoraSaoPaulo();
  const dataAgendada = (agendamento as any).datas?.data as string | undefined;
  const horario = agendamento.horario_termos ? String(agendamento.horario_termos).slice(0, 5) : null;
  if (dataAgendada !== agora.data) return NextResponse.json({ erro: `A confirmação só pode ser realizada no dia agendado (${dataAgendada?.split("-").reverse().join("/")}).` }, { status: 409 });
  if (horario && agora.hora < horario) return NextResponse.json({ erro: `A assinatura está agendada para ${horario}. Aguarde o horário marcado.` }, { status: 409 });
  const assinatura = new Date().toISOString();
  const dataAssinatura = new Date(`${dataAgendada}T12:00:00`); dataAssinatura.setDate(dataAssinatura.getDate() + 90);
  const previsao90 = dataAssinatura.toISOString().slice(0, 10);
  const { error } = await service.from("agendamentos").update({ status: "realizado", termos_assinados_em: assinatura, previsao_liberacao_financeira: previsao90 }).eq("id", agendamento.id);
  if (error) return NextResponse.json({ erro: "Não foi possível confirmar a assinatura." }, { status: 500 });
  await service.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: "confirmou_assinatura_termos", entidade: "agendamentos", entidade_id: agendamento.id, detalhes: { cliente_id: agendamento.cliente_id, data_assinatura: dataAgendada, horario, previsao_liberacao_financeira: previsao90 } });
  try { await service.channel("agenda-clientes").send({ type: "broadcast", event: "datas_atualizadas", payload: { acao: "assinatura_termos_confirmada", agendamentoId: agendamento.id, clienteId: agendamento.cliente_id, data: dataAgendada } }); } catch (erro) { console.error("Falha ao publicar confirmação dos termos:", erro); }
  return NextResponse.json({ ok: true, agendamentoId: agendamento.id, previsaoLiberacaoFinanceira: previsao90 });
}
