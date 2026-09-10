import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const STATUS = ["pendente", "em_analise", "aprovada", "recusada"] as const;
async function autenticar() { const authClient = createServerSupabaseClient(); const { data: { user } } = await authClient.auth.getUser(); return user; }
function data90Dias(iso: string | null | undefined) { if (!iso) return null; const [ano, mes, dia] = iso.split("-").map(Number); if (!ano || !mes || !dia) return null; const d = new Date(ano, mes - 1, dia); d.setDate(d.getDate() + 90); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
async function avisarCliente(clienteId: string, mensagem: string) { try { const supabase = createServiceSupabaseClient(); await supabase.channel(`notificacoes-cliente:${clienteId}`).send({ type: "broadcast", event: "nova_notificacao", payload: { mensagem, tipo: "financeiro" } }); } catch {} }

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await autenticar(); if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id, cliente_id, agendamento_id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, status, observacao, created_at, updated_at, clientes(nome_completo, cpf, quantidade_parcelas), agendamentos(previsao_liberacao_financeira, datas(data))")
    .in("status", ["pendente", "em_analise", "aprovada"]).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  const solicitacoes = (data ?? [])
    .filter((item: any) => !item.agendamentos?.previsao_liberacao_financeira)
    .map((item: any) => { const dataTermos = item.agendamentos?.datas?.data ?? null; return { ...item, data_termos: dataTermos, previsao_sugerida: data90Dias(dataTermos) }; });
  return NextResponse.json({ solicitacoes });
}

export async function PATCH(req: NextRequest) {
  const user = await autenticar(); if (!user) return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = body.id as string | undefined;
  const status = body.status as string | undefined;
  const dataLiberacao = typeof body.dataLiberacaoFinanceira === "string" ? body.dataLiberacaoFinanceira : null;
  const observacao = typeof body.observacao === "string" ? body.observacao.trim() : null;
  if (!id) return NextResponse.json({ erro: "Solicitação inválida." }, { status: 400 });
  if (status && !STATUS.includes(status as (typeof STATUS)[number])) return NextResponse.json({ erro: "Status inválido." }, { status: 400 });

  const supabase = createServiceSupabaseClient();
  const { data: atual, error: erroAtual } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id, cliente_id, agendamento_id, status, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa").eq("id", id).single();
  if (erroAtual || !atual) return NextResponse.json({ erro: "Solicitação não encontrada." }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (observacao !== null) updates.observacao = observacao;
  if (dataLiberacao) {
    if (!atual.agendamento_id) return NextResponse.json({ erro: "A cliente ainda não escolheu a data dos termos. A previsão de liberação será definida após o agendamento." }, { status: 409 });
    updates.status = status ?? "aprovada";
  }
  const { data: atualizado, error } = await supabase.from("solicitacoes_liberacao_financeira").update(updates).eq("id", id)
    .select("id, cliente_id, agendamento_id, status, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, observacao").single();
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  if (dataLiberacao && atual.agendamento_id) {
    const { error: erroAgendamento } = await supabase.from("agendamentos").update({ previsao_liberacao_financeira: dataLiberacao }).eq("id", atual.agendamento_id);
    if (erroAgendamento) return NextResponse.json({ erro: erroAgendamento.message }, { status: 500 });
    await avisarCliente(atual.cliente_id, "Sua data de liberação financeira foi programada. Confira sua agenda no aplicativo.");
  }

  await supabase.from("logs_alteracoes").insert({ usuario: user.email ?? "admin", acao: dataLiberacao ? "programou_liberacao_financeira" : `solicitacao_liberacao_${status ?? "atualizada"}`, entidade: "solicitacoes_liberacao_financeira", entidade_id: id, detalhes: { status: status ?? atual.status, dataLiberacaoFinanceira: dataLiberacao, observacao } });
  return NextResponse.json({ solicitacao: atualizado, dataLiberacaoFinanceira: dataLiberacao });
}
