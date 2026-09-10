import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";

const COOKIE_NAME = "cliente_session";
const HORARIOS_VALIDOS = new Set(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function dataValida(valor: string | undefined) { return Boolean(valor && /^\d{4}-\d{2}-\d{2}$/.test(valor)); }
function adicionarDias(iso: string, dias: number) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function sessao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
}

export async function agenda(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  const supabase = createServiceSupabaseClient(env);
  const { data: cliente } = await supabase.from("clientes").select("id, nome_completo, procedimento, valor_contrato, status_revisao_financeira, financeiro_saldo_restante, financeiro_taxa_cartao, financeiro_total_com_taxa, financeiro_formas_custeio").eq("id", s.clienteId).single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const { data: agendamentos } = await supabase.from("agendamentos").select("id, data_id, status, horario_termos, termos_assinados_em, previsao_liberacao_financeira, created_at, datas(data)").eq("cliente_id", cliente.id).in("status", ["confirmado", "realizado"]).order("created_at", { ascending: false });
  const ativo = (agendamentos ?? []).find((a: any) => a.status === "confirmado") ?? null;
  const concluido = (agendamentos ?? []).find((a: any) => a.status === "realizado") ?? null;
  const dataAssinatura = (ativo as any)?.datas?.data ?? (concluido as any)?.datas?.data ?? null;
  const primeiraCirurgia = dataAssinatura ? adicionarDias(dataAssinatura, 90) : null;
  const { data: solicitacao } = await supabase.from("solicitacoes_liberacao_financeira").select("id, forma_custeio, saldo_restante, taxa_cartao, total_com_taxa, status, observacao, agendamento_id, created_at, updated_at").eq("cliente_id", cliente.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const agendamentoId = ativo?.id ?? concluido?.id ?? null;
  const { data: remarcacoes } = agendamentoId ? await supabase.from("solicitacoes_remarcacao_agendamento").select("id, tipo, status, data_solicitada, horario_termos, observacao, created_at, updated_at").eq("cliente_id", cliente.id).eq("agendamento_id", agendamentoId).order("created_at", { ascending: false }) : { data: [] as any[] };

  const testDate = getCookie(request, "sra_luck_test_date");
  const hoje = dataValida(testDate) ? testDate! : new Date().toISOString().slice(0, 10);
  const { data: datasDisponiveis } = await supabase.from("datas").select("id, data, vagas_totais").eq("status", "disponivel").gte("data", hoje).order("data", { ascending: true });
  const { data: agendamentosAtivos } = await supabase.from("agendamentos").select("data_id").eq("status", "confirmado");
  const ocupacao = new Map<string, number>();
  for (const a of agendamentosAtivos ?? []) ocupacao.set(a.data_id, (ocupacao.get(a.data_id) ?? 0) + 1);
  const datas = (datasDisponiveis ?? []).map((d: any) => ({ id: d.id, data: d.data, vagasRestantes: Math.max(0, d.vagas_totais - (ocupacao.get(d.id) ?? 0)) }));

  const inicioCirurgia = primeiraCirurgia && primeiraCirurgia > hoje ? primeiraCirurgia : hoje;
  const { data: datasCirurgia } = await supabase.from("datas_liberacao_financeira").select("id, data, status").eq("status", "disponivel").gte("data", inicioCirurgia).order("data", { ascending: true });
  const { data: cirurgias } = await supabase.from("agendamentos").select("previsao_liberacao_financeira").eq("status", "confirmado").not("previsao_liberacao_financeira", "is", null);
  const ocupacaoCirurgia = new Map<string, number>();
  for (const a of cirurgias ?? []) { const data = (a as any).previsao_liberacao_financeira as string | null; if (data) ocupacaoCirurgia.set(data, (ocupacaoCirurgia.get(data) ?? 0) + 1); }
  const datasCirurgiaDisponiveis = (datasCirurgia ?? []).map((d: any) => ({ id: d.id, data: d.data, vagasRestantes: Math.max(0, 1 - (ocupacaoCirurgia.get(d.data) ?? 0)) }));

  const mapAgendamento = (a: any) => a ? { id: a.id, data: a.datas?.data, horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null, termosAssinadosEm: a.termos_assinados_em ?? null, previsaoLiberacaoFinanceira: a.previsao_liberacao_financeira ?? null, status: a.status } : null;
  return json({ cliente: { id: cliente.id, nome: cliente.nome_completo, procedimento: cliente.procedimento }, financeiro: { statusRevisao: cliente.status_revisao_financeira ?? null, saldoRestante: cliente.financeiro_saldo_restante ?? null, taxaCartao: cliente.financeiro_taxa_cartao ?? 5.4, totalComTaxa: cliente.financeiro_total_com_taxa ?? null, formasCusteio: Array.isArray(cliente.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : [] }, solicitacaoLiberacaoFinanceira: solicitacao ?? null, remarcacoes: remarcacoes ?? [], agendamentoAtivo: mapAgendamento(ativo), agendamentoConcluido: mapAgendamento(concluido), datasDisponiveis: datas, datasCirurgiaDisponiveis, dataTesteAtiva: dataValida(testDate) ? hoje : null });
}

export async function agendar(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const dataId = body?.dataId as string | undefined;
  const horario = body?.horario as string | undefined;
  if (!dataId || !horario || !HORARIOS_VALIDOS.has(horario)) return json({ erro: "Escolha a data e o horário da assinatura." }, 400);
  const supabase = createServiceSupabaseClient(env);
  const { data: cliente } = await supabase.from("clientes").select("id, valor_contrato").eq("id", s.clienteId).single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);
  const { data: agendamentoId, error } = await supabase.rpc("agendar_data", { p_cliente_id: cliente.id, p_data_id: dataId, p_valor_contrato: cliente.valor_contrato, p_horario_termos: horario });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("DATA_INDISPONIVEL")) return json({ erro: "Essa data não está mais disponível." }, 409);
    if (m.includes("CLIENTE_JA_AGENDADA")) return json({ erro: "Você já tem uma data confirmada. Fale conosco para remarcar." }, 409);
    if (m.includes("VAGAS_ESGOTADAS")) return json({ erro: "As vagas dessa data acabaram de se esgotar." }, 409);
    console.error("Falha ao confirmar agendamento:", error);
    return json({ erro: "Não foi possível confirmar sua data. Tente novamente." }, 500);
  }
  const { data: dataAlvo } = await supabase.from("datas").select("id, data").eq("id", dataId).single();
  await supabase.from("solicitacoes_liberacao_financeira").update({ agendamento_id: agendamentoId }).eq("cliente_id", cliente.id).in("status", ["pendente", "em_analise", "aprovada"]).is("agendamento_id", null);
  return json({ ok: true, agendamentoId, data: dataAlvo?.data, horario });
}

export async function agendarCirurgia(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const data = body?.data as string | undefined;
  if (!data || !dataValida(data)) return json({ erro: "Escolha a data da cirurgia." }, 400);
  const supabase = createServiceSupabaseClient(env);
  const { data: cliente } = await supabase.from("clientes").select("id").eq("id", s.clienteId).single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);
  const { data: agendamento } = await supabase.from("agendamentos").select("id, data_id, previsao_liberacao_financeira, datas(data)").eq("cliente_id", cliente.id).eq("status", "confirmado").maybeSingle();
  if (!agendamento) return json({ erro: "Primeiro escolha a data da assinatura dos termos." }, 409);
  const dataAssinatura = (agendamento as any).datas?.data as string | null;
  if (!dataAssinatura) return json({ erro: "Não foi possível identificar a data da assinatura dos termos." }, 409);
  if (data < adicionarDias(dataAssinatura, 90)) return json({ erro: "Essa data ainda não está disponível para esta cliente." }, 409);
  const { data: solicitacao } = await supabase.from("solicitacoes_liberacao_financeira").select("id").eq("cliente_id", cliente.id).eq("agendamento_id", agendamento.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!solicitacao) return json({ erro: "Informe primeiro como será realizado o custeio do valor restante." }, 409);
  const { error } = await supabase.rpc("agendar_cirurgia_data", { p_agendamento_id: agendamento.id, p_data: data });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("DATA_CIRURGIA_INDISPONIVEL")) return json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, 409);
    if (m.includes("DATA_CIRURGIA_OCUPADA")) return json({ erro: "Essa data acabou de ser ocupada. Escolha outra data disponível." }, 409);
    if (m.includes("AGENDAMENTO_NAO_ENCONTRADO")) return json({ erro: "O agendamento não está mais disponível para alteração." }, 409);
    console.error("Falha ao confirmar data da cirurgia:", error);
    return json({ erro: "Não foi possível confirmar a data da cirurgia." }, 500);
  }
  await supabase.from("solicitacoes_liberacao_financeira").update({ updated_at: new Date().toISOString() }).eq("id", solicitacao.id);
  return json({ ok: true, data });
}
