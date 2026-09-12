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
    .select("id,nome_completo,procedimento,valor_contrato,status_revisao_financeira,financeiro_saldo_restante,financeiro_taxa_cartao,financeiro_total_com_taxa,financeiro_formas_custeio,custeio_confirmado_em,status_financeiro,status_cirurgia")
    .eq("id", s.clienteId)
    .single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const { data: agendamentos } = await supabase.from("agendamentos")
    .select("id,data_id,status,horario_termos,termos_assinados_em,previsao_liberacao_financeira,created_at,datas(data)")
    .eq("cliente_id", cliente.id)
    .in("status", ["confirmado", "realizado"])
    .order("created_at", { ascending: false });
  const ativo = (agendamentos ?? []).find((a: any) => a.status === "confirmado") ?? null;
  const concluido = (agendamentos ?? []).find((a: any) => a.status === "realizado") ?? null;
  const termosConfirmados = (agendamentos ?? []).find((a: any) => Boolean(a.termos_assinados_em)) ?? null;
  const agendaCirurgicaLiberarEm = calcularLiberacaoCirurgica(
    (termosConfirmados as any)?.termos_assinados_em ?? null,
    cliente.custeio_confirmado_em ?? null,
  );

  const { data: solicitacao } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,agendamento_id,created_at,updated_at")
    .eq("cliente_id", cliente.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const agendamentoId = ativo?.id ?? concluido?.id ?? null;
  const { data: remarcacoes } = agendamentoId
    ? await supabase.from("solicitacoes_remarcacao_agendamento")
      .select("id,tipo,status,data_solicitada,horario_termos,observacao,created_at,updated_at")
      .eq("cliente_id", cliente.id)
      .eq("agendamento_id", agendamentoId)
      .order("created_at", { ascending: false })
    : { data: [] as any[] };

  const testDate = getCookie(request, "sra_luck_test_date") ?? undefined;
  const hoje = dataValida(testDate) ? testDate! : agoraSaoPaulo().data;
  const { data: datasDisponiveis } = await supabase.from("datas")
    .select("id,data,vagas_totais")
    .eq("status", "disponivel")
    .gte("data", hoje)
    .order("data", { ascending: true });
  const { data: agendamentosAtivos } = await supabase.from("agendamentos").select("data_id").eq("status", "confirmado");
  const ocupacao = new Map<string, number>();
  for (const a of agendamentosAtivos ?? []) ocupacao.set(a.data_id, (ocupacao.get(a.data_id) ?? 0) + 1);
  const datas = (datasDisponiveis ?? []).map((d: any) => ({
    id: d.id,
    data: d.data,
    vagasRestantes: Math.max(0, d.vagas_totais - (ocupacao.get(d.id) ?? 0)),
  }));

  const agendaCirurgicaLiberada = Boolean(agendaCirurgicaLiberarEm && agendaCirurgicaLiberarEm <= hoje);
  let datasCirurgiaDisponiveis: Array<{ id: string; data: string; vagasRestantes: number }> = [];
  if (agendaCirurgicaLiberada) {
    const { data: datasCirurgia } = await supabase.from("datas_liberacao_financeira")
      .select("id,data,status")
      .eq("status", "disponivel")
      .gte("data", hoje)
      .order("data", { ascending: true });
    const { data: cirurgias } = await supabase.from("agendamentos")
      .select("previsao_liberacao_financeira")
      .in("status", ["confirmado", "realizado"])
      .not("previsao_liberacao_financeira", "is", null);
    const ocupacaoCirurgia = new Map<string, number>();
    for (const a of cirurgias ?? []) {
      const data = (a as any).previsao_liberacao_financeira as string | null;
      if (data) ocupacaoCirurgia.set(data, (ocupacaoCirurgia.get(data) ?? 0) + 1);
    }
    datasCirurgiaDisponiveis = (datasCirurgia ?? []).map((d: any) => ({
      id: d.id,
      data: d.data,
      vagasRestantes: Math.max(0, 1 - (ocupacaoCirurgia.get(d.data) ?? 0)),
    }));
  }

  const mapAgendamento = (a: any) => a ? {
    id: a.id,
    data: a.datas?.data,
    horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null,
    termosAssinadosEm: a.termos_assinados_em ?? null,
    previsaoLiberacaoFinanceira: a.previsao_liberacao_financeira ?? null,
    status: a.status,
  } : null;

  return json({
    cliente: { id: cliente.id, nome: cliente.nome_completo, procedimento: cliente.procedimento },
    financeiro: {
      statusRevisao: cliente.status_revisao_financeira ?? null,
      saldoRestante: cliente.financeiro_saldo_restante ?? null,
      taxaCartao: cliente.financeiro_taxa_cartao ?? 5.4,
      totalComTaxa: cliente.financeiro_total_com_taxa ?? null,
      formasCusteio: Array.isArray(cliente.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : [],
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
    agendaCirurgicaLiberarEm,
    agendaCirurgicaLiberada,
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
  const { data: custeioAprovado } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id")
    .eq("cliente_id", cliente.id)
    .eq("status", "aprovada")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!custeioAprovado) return json({ erro: "Escolha primeiro a forma de pagamento do saldo restante para liberar a escolha da data." }, 409);
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
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const data = body?.data as string | undefined;
  if (!data || !dataValida(data)) return json({ erro: "Escolha a data da cirurgia." }, 400);

  const supabase = createServiceSupabaseClient(env);
  const { data: cliente } = await supabase.from("clientes")
    .select("id,custeio_confirmado_em")
    .eq("id", s.clienteId)
    .single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const { data: agendamento } = await supabase.from("agendamentos")
    .select("id,data_id,status,termos_assinados_em,previsao_liberacao_financeira,datas(data)")
    .eq("cliente_id", cliente.id)
    .in("status", ["realizado", "confirmado"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!agendamento) return json({ erro: "Primeiro escolha a data da assinatura dos termos." }, 409);
  if (!agendamento.termos_assinados_em) return json({ erro: "Os termos ainda não foram assinados." }, 409);
  if (!cliente.custeio_confirmado_em) return json({ erro: "A quitação do saldo ainda não foi confirmada." }, 409);

  const liberacao = calcularLiberacaoCirurgica(agendamento.termos_assinados_em, cliente.custeio_confirmado_em);
  if (!liberacao) return json({ erro: "Não foi possível calcular a liberação da agenda cirúrgica." }, 409);
  const hoje = agoraSaoPaulo().data;
  if (hoje < liberacao) return json({ erro: `A agenda cirúrgica será liberada a partir de ${liberacao.split("-").reverse().join("/")}.`, agendaCirurgicaLiberarEm: liberacao }, 409);
  if (data < liberacao) return json({ erro: `Escolha uma data a partir de ${liberacao.split("-").reverse().join("/")}.`, agendaCirurgicaLiberarEm: liberacao }, 409);

  const { data: solicitacao } = await supabase.from("solicitacoes_liberacao_financeira")
    .select("id")
    .eq("cliente_id", cliente.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!solicitacao) return json({ erro: "Informe primeiro como será realizado o custeio do valor restante." }, 409);

  const { error } = await supabase.rpc("agendar_cirurgia_data", { p_agendamento_id: agendamento.id, p_data: data });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("TERMOS_NAO_ASSINADOS")) return json({ erro: "Os termos ainda não foram assinados." }, 409);
    if (m.includes("SALDO_NAO_QUITADO")) return json({ erro: "A quitação do saldo ainda não foi confirmada." }, 409);
    if (m.includes("PRAZO_CIRURGICO_NAO_CONCLUIDO")) return json({ erro: `A agenda cirúrgica será liberada a partir de ${liberacao.split("-").reverse().join("/")}.` }, 409);
    if (m.includes("DATA_CIRURGIA_INDISPONIVEL")) return json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, 409);
    if (m.includes("DATA_CIRURGIA_OCUPADA")) return json({ erro: "Essa data acabou de ser ocupada. Escolha outra data disponível." }, 409);
    if (m.includes("AGENDAMENTO_NAO_ENCONTRADO")) return json({ erro: "O agendamento não está mais disponível para alteração." }, 409);
    console.error("Falha ao confirmar data da cirurgia:", error);
    return json({ erro: "Não foi possível confirmar a data da cirurgia." }, 500);
  }
  await supabase.from("solicitacoes_liberacao_financeira").update({ updated_at: new Date().toISOString() }).eq("id", solicitacao.id);
  return json({ ok: true, data, agendaCirurgicaLiberarEm: liberacao });
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

  if (existente) {
    if (!existente.agendamento_id && agendamentoAtivo?.id) {
      const { data: vinculada, error: erroVinculo } = await supabase.from("solicitacoes_liberacao_financeira")
        .update({ agendamento_id: agendamentoAtivo.id })
        .eq("id", existente.id)
        .select("id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,agendamento_id")
        .single();
      if (erroVinculo) return json({ erro: erroVinculo.message }, 500);
      return json({ solicitacao: vinculada });
    }
    return json({ erro: "Sua escolha de custeio já foi enviada para nossa equipe." }, 409);
  }

  const observacao = formaCusteio === "cheques" || formaCusteio === "boleto_100"
    ? "Forma de custeio sujeita a análise de até 5 dias úteis."
    : "A escolha foi registrada e retornou para o painel administrativo.";

  const { data, error } = await supabase.from("solicitacoes_liberacao_financeira").insert({
    cliente_id: cliente.id,
    agendamento_id: agendamentoAtivo?.id ?? null,
    forma_custeio: formaCusteio,
    saldo_restante: saldoRestante,
    taxa_cartao: taxaCartao,
    total_com_taxa: totalComTaxa,
    status: "pendente",
    observacao,
  }).select("id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,agendamento_id,created_at").single();
  if (error) return json({ erro: error.message }, 500);

  await supabase.from("logs_alteracoes").insert({
    usuario: `cliente:${cliente.id}`,
    acao: "solicitou_liberacao_financeira",
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
