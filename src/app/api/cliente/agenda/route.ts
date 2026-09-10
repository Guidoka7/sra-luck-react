import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { CLIENTE_COOKIE_NAME, verificarTokenSessao } from "@/lib/session";

function mapAgendamento(a: any) {
  return a ? { id: a.id, data: a.datas?.data, horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null, termosAssinadosEm: a.termos_assinados_em ?? null, previsaoLiberacaoFinanceira: a.previsao_liberacao_financeira ?? null, status: a.status } : null;
}
function dataTesteValida(valor: string | undefined) { return Boolean(valor && /^\d{4}-\d{2}-\d{2}$/.test(valor)); }
function adicionarDias(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE_NAME)?.value;
  const sessao = await verificarTokenSessao(token);
  if (!sessao) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const supabase = createServiceSupabaseClient();
  const { data: cliente } = await supabase.from("clientes").select("id, nome_completo, procedimento, valor_contrato, status_revisao_financeira, financeiro_saldo_restante, financeiro_taxa_cartao, financeiro_total_com_taxa, financeiro_formas_custeio").eq("id", sessao.clienteId).single();
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrada." }, { status: 404 });

  const { data: agendamentos } = await supabase.from("agendamentos").select("id, data_id, status, horario_termos, termos_assinados_em, previsao_liberacao_financeira, created_at, datas(data)").eq("cliente_id", cliente.id).in("status", ["confirmado", "realizado"]).order("created_at", { ascending: false });
  const agendamentoAtivo = (agendamentos ?? []).find((a: any) => a.status === "confirmado") ?? null;
  const agendamentoConcluido = (agendamentos ?? []).find((a: any) => a.status === "realizado") ?? null;
  const dataAssinaturaTermos = (agendamentoAtivo as any)?.datas?.data ?? (agendamentoConcluido as any)?.datas?.data ?? null;
  const primeiraDataCirurgia = dataAssinaturaTermos ? adicionarDias(dataAssinaturaTermos, 90) : null;
  const { data: solicitacao } = await supabase.from("solicitacoes_liberacao_financeira").select("id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, status, observacao, agendamento_id, created_at, updated_at").eq("cliente_id", cliente.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const agendamentoId = agendamentoAtivo?.id ?? agendamentoConcluido?.id ?? null;
  const { data: remarcacoes } = agendamentoId
    ? await supabase.from("solicitacoes_remarcacao_agendamento").select("id, tipo, status, data_solicitada, horario_termos, observacao, created_at, updated_at").eq("cliente_id", cliente.id).eq("agendamento_id", agendamentoId).order("created_at", { ascending: false })
    : { data: [] as any[] };

  const testDate = req.cookies.get("sra_luck_test_date")?.value;
  const hoje = dataTesteValida(testDate) ? testDate! : new Date().toISOString().slice(0, 10);

  const { data: datasDisponiveis } = await supabase.from("datas").select("id, data, vagas_totais").eq("status", "disponivel").gte("data", hoje).order("data", { ascending: true });
  const { data: agendamentosAtivos } = await supabase.from("agendamentos").select("data_id").eq("status", "confirmado");
  const ocupacaoPorData = new Map<string, number>();
  for (const a of agendamentosAtivos ?? []) ocupacaoPorData.set(a.data_id, (ocupacaoPorData.get(a.data_id) ?? 0) + 1);
  const datas = (datasDisponiveis ?? []).map((d: { id: string; data: string; vagas_totais: number }) => ({ id: d.id, data: d.data, vagasRestantes: Math.max(0, d.vagas_totais - (ocupacaoPorData.get(d.id) ?? 0)) }));

  const inicioBuscaCirurgia = primeiraDataCirurgia && primeiraDataCirurgia > hoje ? primeiraDataCirurgia : hoje;
  const { data: datasCirurgia } = await supabase.from("datas_liberacao_financeira").select("id, data, status").eq("status", "disponivel").gte("data", inicioBuscaCirurgia).order("data", { ascending: true });
  const { data: cirurgiasAgendadas } = await supabase.from("agendamentos").select("previsao_liberacao_financeira").eq("status", "confirmado").not("previsao_liberacao_financeira", "is", null);
  const ocupacaoCirurgia = new Map<string, number>();
  for (const a of cirurgiasAgendadas ?? []) { const data = (a as any).previsao_liberacao_financeira as string | null; if (data) ocupacaoCirurgia.set(data, (ocupacaoCirurgia.get(data) ?? 0) + 1); }
  const datasCirurgiaDisponiveis = (datasCirurgia ?? []).map((d: { id: string; data: string }) => ({ id: d.id, data: d.data, vagasRestantes: Math.max(0, 1 - (ocupacaoCirurgia.get(d.data) ?? 0)) }));

  return NextResponse.json({
    cliente: { id: cliente.id, nome: cliente.nome_completo, procedimento: cliente.procedimento },
    financeiro: { statusRevisao: cliente.status_revisao_financeira ?? null, saldoRestante: cliente.financeiro_saldo_restante ?? null, taxaCartao: cliente.financeiro_taxa_cartao ?? 5.4, totalComTaxa: cliente.financeiro_total_com_taxa ?? null, formasCusteio: Array.isArray(cliente.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : [] },
    solicitacaoLiberacaoFinanceira: solicitacao ?? null,
    remarcacoes: remarcacoes ?? [],
    agendamentoAtivo: mapAgendamento(agendamentoAtivo),
    agendamentoConcluido: mapAgendamento(agendamentoConcluido),
    datasDisponiveis: datas,
    datasCirurgiaDisponiveis,
    dataTesteAtiva: dataTesteValida(testDate) ? hoje : null,
  });
}
