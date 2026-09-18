import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";
import { agoraSaoPaulo, calcularLiberacaoCirurgica } from "./surgery-release";

const COOKIE_NAME = "cliente_session";
const HORARIOS_VALIDOS = new Set(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"]);

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function dataValida(valor: string | undefined) {
  return Boolean(valor && /^\d{4}-\d{2}-\d{2}$/.test(valor));
}

async function sessao(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
}

export async function agenda(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  const supabase = createServiceSupabaseClient(env);
  const { data: cliente } = await supabase.from("clientes")
    .select("id,nome_completo,procedimento,valor_contrato,status_revisao_financeira,financeiro_saldo_restante,financeiro_taxa_cartao,financeiro_total_com_taxa,financeiro_formas_custeio,financeiro_confirmado_em,custeio_confirmado_em,status_financeiro,status_cirurgia")
    .eq("id", s.clienteId)
    .single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const { data: agendamentos } = await supabase.from("agendamentos")
    .select("id,data_id,status,horario_termos,termos_assinados_em,comparecimento_status,comparecimento_em,previsao_cirurgia,previsao_cirurgia_confirmada_em,quitacao_status,quitacao_em,quitacao_metodo,agenda_cirurgica_liberada_em,data_cirurgia,horario_cirurgia,cirurgia_escolhida_em,created_at,datas(data)")
    .eq("cliente_id", cliente.id)
    .in("status", ["confirmado", "realizado"])
    .order("created_at", { ascending: false });
  const ativo = (agendamentos ?? []).find((a: any) => a.status === "confirmado") ?? null;
  const concluido = (agendamentos ?? []).find((a: any) => a.status === "realizado") ?? null;
  const agendaAtual = ativo ?? concluido;

  const { data: solicitacao } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,agendamento_id,created_at,updated_at")
    .eq("cliente_id", cliente.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const agendamentoId = agendaAtual?.id ?? null;
  const { data: remarcacoes } = agendamentoId
    ? await supabase.from("solicitacoes_remarcacao_agendamento")
      .select("id,tipo,status,data_solicitada,horario_termos,observacao,created_at,updated_at")
      .eq("cliente_id", cliente.id)
      .eq("agendamento_id", agendamentoId)
      .order("created_at", { ascending: false })
    : { data: [] as any[] };

  const testDate = getCookie(request, "sra_luck_test_date") ?? undefined;
  const hoje = dataValida(testDate) ? testDate! : agoraSaoPaulo().data;
  const etapa4 = Boolean(
    cliente.status_revisao_financeira === "aprovada"
    && cliente.financeiro_confirmado_em
    && solicitacao
    && solicitacao.status !== "recusada"
  );

  let datas: Array<{ id: string; data: string; vagasRestantes: number; horarios: { id: string; horario: string; vagasRestantes: number }[] }> = [];
  if (etapa4 && !agendaAtual) {
    const { data: datasConfiguradas } = await supabase.from("datas")
      .select("id,data,vagas_totais,status,fechamento_manual")
      .eq("status", "disponivel")
      .eq("fechamento_manual", false)
      .gt("vagas_totais", 0)
      .gte("data", hoje)
      .order("data", { ascending: true });

    const ids = (datasConfiguradas ?? []).map((item: any) => item.id);
    const { data: ocupacoes } = ids.length
      ? await supabase.from("agendamentos").select("data_id,status").in("data_id", ids).in("status", ["confirmado","realizado"])
      : { data: [] as any[] };
    const used = new Map<string, number>();
    for (const item of ocupacoes ?? []) used.set(item.data_id, (used.get(item.data_id) ?? 0) + 1);

    datas = (datasConfiguradas ?? []).map((item: any) => {
      const remaining = Math.max(0, Number(item.vagas_totais ?? 0) - (used.get(item.id) ?? 0));
      return {
        id: item.id,
        data: item.data,
        vagasRestantes: remaining,
        horarios: TERM_TIMES.map((horario) => ({ id: item.id + ":" + horario, horario, vagasRestantes: remaining })),
      };
    }).filter((item) => item.vagasRestantes > 0);
  }

  const agendaCirurgicaLiberada = Boolean(agendaAtual?.agenda_cirurgica_liberada_em);
  const previsaoCirurgia = agendaAtual?.previsao_cirurgia ?? null;
  let datasCirurgiaDisponiveis: Array<{
    id: string;
    data: string;
    vagasRestantes: number;
    status: "disponivel" | "lotada" | "fechada";
    horarios: { horario: string; disponivel: boolean }[];
  }> = [];

  if (agendaCirurgicaLiberada && previsaoCirurgia) {
    const { data: cirurgiaDatas } = await supabase.from("datas_liberacao_financeira")
      .select("id,data,status,vagas_totais,fechamento_manual")
      .gte("data", hoje)
      .order("data", { ascending: true });

    const { data: ocupacoes } = await supabase.from("agendamentos")
      .select("id,data_cirurgia,horario_cirurgia,status")
      .in("status", ["confirmado","realizado"])
      .not("data_cirurgia", "is", null);

    const used = new Map<string, number>();
    const occupiedTimes = new Map<string, Set<string>>();
    for (const item of ocupacoes ?? []) {
      if (!item.data_cirurgia) continue;
      used.set(item.data_cirurgia, (used.get(item.data_cirurgia) ?? 0) + 1);
      if (item.horario_cirurgia) {
        const set = occupiedTimes.get(item.data_cirurgia) ?? new Set<string>();
        set.add(String(item.horario_cirurgia).slice(0,5));
        occupiedTimes.set(item.data_cirurgia, set);
      }
    }

    datasCirurgiaDisponiveis = (cirurgiaDatas ?? []).map((item: any) => {
      const total = Number(item.vagas_totais ?? 0);
      const remaining = Math.max(0, total - (used.get(item.data) ?? 0));
      const beforeForecast = item.data < previsaoCirurgia;
      const manuallyClosed = item.status !== "disponivel" || Boolean(item.fechamento_manual) || total <= 0;
      const full = remaining <= 0;
      const status = beforeForecast || full ? "lotada" as const : manuallyClosed ? "fechada" as const : "disponivel" as const;
      const occupied = occupiedTimes.get(item.data) ?? new Set<string>();
      return {
        id: item.id,
        data: item.data,
        vagasRestantes: status === "disponivel" ? remaining : 0,
        status,
        horarios: SURGERY_TIMES.map((horario) => ({ horario, disponivel: status === "disponivel" && !occupied.has(horario) })),
      };
    });
  }

  const mapAgendamento = (a: any) => a ? {
    id: a.id,
    data: Array.isArray(a.datas) ? a.datas[0]?.data : a.datas?.data,
    horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null,
    termosAssinadosEm: a.termos_assinados_em ?? null,
    comparecimentoStatus: a.comparecimento_status ?? "pendente",
    previsaoCirurgia: a.previsao_cirurgia ?? null,
    previsaoCirurgiaConfirmadaEm: a.previsao_cirurgia_confirmada_em ?? null,
    quitacaoStatus: a.quitacao_status ?? "pendente",
    agendaCirurgicaLiberadaEm: a.agenda_cirurgica_liberada_em ?? null,
    dataCirurgia: a.data_cirurgia ?? null,
    horarioCirurgia: a.horario_cirurgia ? String(a.horario_cirurgia).slice(0,5) : null,
    previsaoLiberacaoFinanceira: a.data_cirurgia ?? null,
    status: a.status,
  } : null;

  return json({
    cliente: { id: cliente.id, nome: cliente.nome_completo ?? "Cliente", procedimento: cliente.procedimento ?? null },
    financeiro: {
      statusRevisao: cliente.status_revisao_financeira ?? null,
      saldoRestante: cliente.financeiro_saldo_restante ?? null,
      taxaCartao: cliente.financeiro_taxa_cartao ?? 5.4,
      totalComTaxa: cliente.financeiro_total_com_taxa ?? null,
      formasCusteio: Array.isArray(cliente.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : [],
      financeiroConfirmadoEm: cliente.financeiro_confirmado_em ?? null,
      custeioConfirmadoEm: cliente.custeio_confirmado_em ?? null,
      statusFinanceiro: cliente.status_financeiro ?? null,
      statusCirurgia: cliente.status_cirurgia ?? null,
    },
    solicitacaoLiberacaoFinanceira: solicitacao ?? null,
    remarcacoes: remarcacoes ?? [],
    agendamentoAtivo: mapAgendamento(ativo),
    agendamentoConcluido: mapAgendamento(concluido),
    datasDisponiveis: datas,
    datasCirurgiaDisponiveis,
    previsaoCirurgia,
    agendaCirurgicaLiberarEm: previsaoCirurgia,
    agendaCirurgicaLiberada,
    etapa4,
    dataTesteAtiva: dataValida(testDate) ? hoje : null,
  });
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
  const { data: cliente } = await supabase.from("clientes").select("id,valor_contrato,status_revisao_financeira,financeiro_saldo_restante").eq("id", s.clienteId).single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);
  if (cliente.status_revisao_financeira !== "aprovada" || cliente.financeiro_saldo_restante == null) {
    return json({ erro: "O levantamento financeiro ainda não foi concluído." }, 409);
  }
  const { data: custeioEscolhido } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id")
    .eq("cliente_id", cliente.id)
    .in("status", ["pendente", "em_analise", "aprovada"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!custeioEscolhido) return json({ erro: "Escolha primeiro a forma de pagamento do saldo restante para liberar a escolha da data." }, 409);
  const { data: agendamentoId, error } = await supabase.rpc("agendar_data", {
    p_cliente_id: cliente.id,
    p_data_id: dataId,
    p_valor_contrato: cliente.valor_contrato,
    p_horario_termos: horario,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("DATA_INDISPONIVEL")) return json({ erro: "Essa data não está mais disponível." }, 409);
    if (m.includes("CLIENTE_JA_AGENDADA")) return json({ erro: "Você já tem uma data confirmada. Fale conosco para remarcar." }, 409);
    if (m.includes("VAGAS_ESGOTADAS")) return json({ erro: "As vagas dessa data acabaram de se esgotar." }, 409);
    console.error("Falha ao confirmar agendamento:", error);
    return json({ erro: "Não foi possível confirmar sua data. Tente novamente." }, 500);
  }
  const { data: dataAlvo } = await supabase.from("datas").select("id,data").eq("id", dataId).single();
  await supabase.from("solicitacoes_liberacao_financeira")
    .update({ agendamento_id: agendamentoId })
    .eq("cliente_id", cliente.id)
    .in("status", ["pendente", "em_analise", "aprovada"])
    .is("agendamento_id", null);
  return json({ ok: true, agendamentoId, data: dataAlvo?.data, horario });
}

export async function agendarCirurgia(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let payload: any;
  try { payload = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const data = payload?.data as string | undefined;
  const horario = payload?.horario as string | undefined;
  if (!data || !dataValida(data)) return json({ erro: "Escolha a data da cirurgia." }, 400);
  if (!horario || !SURGERY_TIMES.includes(horario)) return json({ erro: "Escolha o horário da cirurgia." }, 400);

  const supabase = createServiceSupabaseClient(env);
  const { data: agendamentoId, error } = await supabase.rpc("agenda_reservar_cirurgia", {
    p_cliente_id: s.clienteId,
    p_data: data,
    p_horario: horario,
    p_usuario: "cliente:" + s.clienteId,
  });
  if (error) {
    const message = String(error.message ?? "");
    if (message.includes("AGENDA_CIRURGICA_NAO_LIBERADA")) return json({ erro: "Sua agenda cirúrgica ainda não foi liberada." }, 409);
    if (message.includes("ANTES_DA_PREVISAO")) return json({ erro: "Essa data é anterior à previsão confirmada para sua cirurgia." }, 409);
    if (message.includes("DATA_PASSADA")) return json({ erro: "Escolha uma data futura." }, 409);
    if (message.includes("DATA_CIRURGIA_INDISPONIVEL")) return json({ erro: "Essa data não está disponível para a sua cirurgia." }, 409);
    if (message.includes("VAGAS_ESGOTADAS")) return json({ erro: "As vagas dessa data acabaram de se esgotar." }, 409);
    if (message.includes("HORARIO_OCUPADO")) return json({ erro: "Esse horário acabou de ser ocupado. Escolha outro." }, 409);
    if (message.includes("HORARIO_INVALIDO")) return json({ erro: "Escolha um horário válido." }, 400);
    console.error("Falha ao confirmar data da cirurgia:", error);
    return json({ erro: "Não foi possível confirmar a data da cirurgia." }, 500);
  }
  return json({ ok: true, agendamentoId, data, horario });
}

export async function agendaTermos(request: Request, env: Env): Promise<Response> {
  const response = await agenda(request, env);
  if (!response.ok) return response;
  const data = await response.json() as any;
  return json({
    etapa4: Boolean(data.etapa4),
    agendamento: data.agendamentoAtivo ?? data.agendamentoConcluido ?? null,
    datas: data.datasDisponiveis ?? [],
  });
}

export async function agendaCirurgias(request: Request, env: Env): Promise<Response> {
  const response = await agenda(request, env);
  if (!response.ok) return response;
  const data = await response.json() as any;
  return json({
    liberada: Boolean(data.agendaCirurgicaLiberada),
    previsao: data.previsaoCirurgia ?? null,
    agendamento: data.agendamentoAtivo ?? data.agendamentoConcluido ?? null,
    datas: data.datasCirurgiaDisponiveis ?? [],
  });
}

const FORMAS_CUSTEIO = ["cartao", "pix", "cheques", "boleto_100"] as const;
type FormaCusteio = (typeof FORMAS_CUSTEIO)[number];

export async function solicitarLiberacaoFinanceira(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const formaCusteio = body?.formaCusteio as FormaCusteio | undefined;
  if (!formaCusteio || !FORMAS_CUSTEIO.includes(formaCusteio)) return json({ erro: "Escolha uma forma de custeio válida." }, 400);

  const supabase = createServiceSupabaseClient(env);
  const { data: cliente, error: erroCliente } = await supabase.from("clientes")
    .select("id,nome_completo,status_revisao_financeira,financeiro_saldo_restante,financeiro_taxa_cartao,financeiro_total_com_taxa,financeiro_formas_custeio")
    .eq("id", s.clienteId)
    .single();
  if (erroCliente || !cliente) return json({ erro: "Cliente não encontrada." }, 404);
  if (cliente.status_revisao_financeira !== "aprovada" || cliente.financeiro_saldo_restante == null) {
    return json({ erro: "O levantamento financeiro ainda não foi confirmado pela nossa equipe." }, 409);
  }

  const formasPermitidas = (Array.isArray(cliente.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : []) as string[];
  if (!formasPermitidas.includes(formaCusteio)) return json({ erro: "Essa forma de custeio não está disponível para o seu contrato." }, 409);

  const saldoRestante = Math.round(Number(cliente.financeiro_saldo_restante) * 100) / 100;
  const taxaCartao = formaCusteio === "cartao" ? Number(cliente.financeiro_taxa_cartao ?? 5.4) : 0;
  const totalComTaxa = formaCusteio === "cartao"
    ? Math.round((saldoRestante * (1 + taxaCartao / 100)) * 100) / 100
    : saldoRestante;

  const { data: agendamentoAtivo } = await supabase.from("agendamentos")
    .select("id")
    .eq("cliente_id", cliente.id)
    .eq("status", "confirmado")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existente } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id,status,agendamento_id")
    .eq("cliente_id", cliente.id)
    .in("status", ["pendente", "em_analise", "aprovada"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const observacao = "Forma de pagamento escolhida pela cliente. O saldo restante deverá ser quitado no ato da assinatura dos termos.";

  if (existente) {
    const { data: atualizada, error: erroAtualizacao } = await supabase.from("solicitacoes_liberacao_financeira")
      .update({
        forma_custeio: formaCusteio,
        saldo_restante: saldoRestante,
        taxa_cartao: taxaCartao,
        total_com_taxa: totalComTaxa,
        status: "aprovada",
        observacao,
        agendamento_id: existente.agendamento_id ?? agendamentoAtivo?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existente.id)
      .select("id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,agendamento_id,created_at")
      .single();
    if (erroAtualizacao) return json({ erro: erroAtualizacao.message }, 500);
    return json({ solicitacao: atualizada });
  }

  const { data, error } = await supabase.from("solicitacoes_liberacao_financeira").insert({
    cliente_id: cliente.id,
    agendamento_id: agendamentoAtivo?.id ?? null,
    forma_custeio: formaCusteio,
    saldo_restante: saldoRestante,
    taxa_cartao: taxaCartao,
    total_com_taxa: totalComTaxa,
    status: "aprovada",
    observacao,
  }).select("id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,agendamento_id,created_at").single();
  if (error) return json({ erro: error.message }, 500);

  await supabase.from("logs_alteracoes").insert({
    usuario: `cliente:${cliente.id}`,
    acao: "escolheu_forma_custeio_saldo",
    entidade: "solicitacoes_liberacao_financeira",
    entidade_id: data.id,
    detalhes: { cliente: cliente.nome_completo, formaCusteio, saldoRestante, taxaCartao, totalComTaxa, agendamentoId: agendamentoAtivo?.id ?? null },
  });
  return json({ solicitacao: data });
}

export async function remarcarAgendamento(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const tipo: "termos" | "cirurgia" = body?.tipo === "cirurgia" ? "cirurgia" : "termos";
  const dataId = typeof body?.dataId === "string" ? body.dataId : undefined;
  const dataEscolhida = typeof body?.data === "string" ? body.data : undefined;
  const horario = typeof body?.horario === "string" ? body.horario : undefined;

  if (tipo === "termos" && (!dataId || !horario || !HORARIOS_VALIDOS.has(horario))) {
    return json({ erro: "Escolha a nova data e o horário da assinatura." }, 400);
  }
  if (tipo === "cirurgia" && (!dataEscolhida || !dataValida(dataEscolhida))) {
    return json({ erro: "Escolha a nova data da cirurgia." }, 400);
  }

  const supabase = createServiceSupabaseClient(env);
  const { data: agendamento } = await supabase.from("agendamentos")
    .select("id,data_id,horario_termos,termos_assinados_em,previsao_liberacao_financeira,datas(data)")
    .eq("cliente_id", s.clienteId)
    .eq("status", "confirmado")
    .maybeSingle();
  if (!agendamento) return json({ erro: "Não existe um agendamento confirmado para alterar." }, 409);

  // A assinatura dos termos só pode ser remarcada uma única vez: uma solicitação
  // já existente (aprovada, recusada ou ainda pendente) esgota essa exceção.
  if (tipo === "termos") {
    const { data: jaUsada } = await supabase.from("solicitacoes_remarcacao_agendamento")
      .select("id")
      .eq("agendamento_id", agendamento.id)
      .eq("tipo", "termos")
      .maybeSingle();
    if (jaUsada) return json({ erro: "Você já utilizou sua única alteração de data para a assinatura dos termos. Fale com nossa equipe se precisar de outra exceção." }, 409);
  }

  let dataSolicitada: string;
  if (tipo === "termos") {
    const { data: dataAlvo } = await supabase.from("datas").select("id,data,vagas_totais,status").eq("id", dataId!).maybeSingle();
    if (!dataAlvo || dataAlvo.status !== "disponivel") return json({ erro: "Essa data não está mais disponível." }, 409);
    const { count } = await supabase.from("agendamentos").select("id", { count: "exact", head: true }).eq("data_id", dataId!).eq("status", "confirmado").neq("id", agendamento.id);
    if ((count ?? 0) >= dataAlvo.vagas_totais) return json({ erro: "As vagas dessa data acabaram de se esgotar." }, 409);
    dataSolicitada = dataAlvo.data;
  } else {
    const { data: cliente } = await supabase.from("clientes").select("custeio_confirmado_em").eq("id", s.clienteId).maybeSingle();
    const liberacao = calcularLiberacaoCirurgica((agendamento as any).termos_assinados_em ?? null, cliente?.custeio_confirmado_em ?? null);
    if (!liberacao) return json({ erro: "A liberação da agenda cirúrgica ainda não foi calculada para o seu contrato." }, 409);
    if (dataEscolhida! < liberacao) return json({ erro: `A cirurgia só pode ser agendada a partir de ${liberacao.split("-").reverse().join("/")}.`, agendaCirurgicaLiberarEm: liberacao }, 409);
    const { data: dataAlvo } = await supabase.from("datas_liberacao_financeira").select("id,data,status").eq("data", dataEscolhida!).maybeSingle();
    if (!dataAlvo || dataAlvo.status !== "disponivel") return json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, 409);
    const { count } = await supabase.from("agendamentos").select("id", { count: "exact", head: true }).eq("status", "confirmado").eq("previsao_liberacao_financeira", dataEscolhida!).neq("id", agendamento.id);
    if ((count ?? 0) > 0) return json({ erro: "Essa data acabou de ser ocupada. Escolha outra data disponível." }, 409);
    dataSolicitada = dataEscolhida!;
  }

  const payload = {
    cliente_id: s.clienteId,
    agendamento_id: agendamento.id,
    tipo,
    data_id: tipo === "termos" ? dataId! : null,
    data_solicitada: dataSolicitada,
    horario_termos: tipo === "termos" ? horario! : null,
    status: "pendente",
    updated_at: new Date().toISOString(),
  };

  const { data: solicitacao, error } = tipo === "termos"
    ? await supabase.from("solicitacoes_remarcacao_agendamento").insert(payload).select("id,tipo,status,data_solicitada,horario_termos,created_at").single()
    : await supabase.from("solicitacoes_remarcacao_agendamento").upsert(payload, { onConflict: "agendamento_id,tipo" }).select("id,tipo,status,data_solicitada,horario_termos,created_at").single();
  if (error) return json({ erro: `Não foi possível enviar sua solicitação de alteração: ${error.message}` }, 500);

  return json({
    ok: true,
    solicitacao,
    mensagem: "Sua solicitação de alteração foi enviada para análise. O prazo é de até 5 dias úteis. Sua agenda atual permanece inalterada até a autorização.",
  });
}
