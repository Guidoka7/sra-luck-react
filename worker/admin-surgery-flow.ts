import { exigirAdmin } from "./admin-auth";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { agoraSaoPaulo, calcularLiberacaoCirurgica, dataSaoPaulo } from "./surgery-release";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try { return await request.json() as Record<string, unknown>; } catch { return {}; }
}

function one<T = any>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatarData(data: string | null) {
  return data ? data.split("-").reverse().join("/") : null;
}

function erroAgendaCirurgica(error: any, liberacaoMinima?: string | null) {
  const mensagem = String(error?.message ?? "");
  if (mensagem.includes("TERMOS_NAO_ASSINADOS")) return json({ erro: "Os termos ainda não foram assinados." }, 409);
  if (mensagem.includes("SALDO_NAO_QUITADO")) return json({ erro: "A quitação do saldo ainda não foi confirmada." }, 409);
  if (mensagem.includes("PRAZO_CIRURGICO_NAO_CONCLUIDO")) {
    return json({
      erro: liberacaoMinima
        ? `A agenda cirúrgica será liberada a partir de ${formatarData(liberacaoMinima)}.`
        : "O prazo de 5 dias úteis após assinatura e quitação ainda não terminou.",
      agendaCirurgicaLiberarEm: liberacaoMinima ?? null,
    }, 409);
  }
  if (mensagem.includes("DATA_CIRURGIA_INDISPONIVEL")) return json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, 409);
  if (mensagem.includes("DATA_CIRURGIA_OCUPADA")) return json({ erro: "Essa data acabou de ser ocupada. Escolha outra data disponível." }, 409);
  if (mensagem.includes("AGENDAMENTO_NAO_ENCONTRADO")) return json({ erro: "O agendamento não está mais disponível para alteração." }, 409);
  console.error("Falha ao atualizar agenda cirúrgica:", error);
  return json({ erro: "Não foi possível atualizar a agenda cirúrgica." }, 500);
}

async function listarAgendamentosTermos(env: Env) {
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.from("agendamentos")
    .select("id,cliente_id,status,horario_termos,termos_assinados_em,created_at,valor_contrato,clientes(id,nome_completo,cpf,status_revisao_financeira,status_financeiro,status_cirurgia,financeiro_saldo_restante,financeiro_formas_custeio,custeio_confirmado_em),datas!inner(data)")
    .eq("status", "confirmado")
    .order("data", { ascending: true, foreignTable: "datas" })
    .order("horario_termos", { ascending: true });
  if (error) return json({ erro: error.message }, 500);

  const hoje = agoraSaoPaulo();
  const agendamentos = (data ?? []).map((a: any) => {
    const cliente = one(a.clientes);
    const dataAgenda = one(a.datas);
    const dataAgendada = dataAgenda?.data ?? null;
    const horario = a.horario_termos ? String(a.horario_termos).slice(0, 5) : null;
    const ehHoje = dataAgendada === hoje.data;
    return {
      id: a.id,
      clienteId: a.cliente_id,
      nome: cliente?.nome_completo ?? "Cliente sem nome",
      cpf: cliente?.cpf ?? null,
      data: dataAgendada,
      horario,
      criadoEm: a.created_at,
      statusRevisaoFinanceira: cliente?.status_revisao_financeira ?? null,
      statusFinanceiro: cliente?.status_financeiro ?? null,
      statusCirurgia: cliente?.status_cirurgia ?? null,
      valorContrato: Number(a.valor_contrato ?? 0),
      saldoRestante: cliente?.financeiro_saldo_restante == null ? null : Number(cliente.financeiro_saldo_restante),
      formasCusteio: Array.isArray(cliente?.financeiro_formas_custeio) ? cliente.financeiro_formas_custeio : [],
      podeConfirmarAssinatura: ehHoje && (!horario || hoje.hora >= horario),
      ehHoje,
    };
  });
  return json({ agendamentos, hoje });
}

async function confirmarAssinaturaTermos(request: Request, env: Env) {
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await parseBody(request);
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return json({ erro: "Agendamento não informado." }, 400);

  const db = createServiceSupabaseClient(env);
  const { data: agendamento, error: buscaError } = await db.from("agendamentos")
    .select("id,cliente_id,status,horario_termos,termos_assinados_em,datas!inner(data),clientes(id,custeio_confirmado_em)")
    .eq("id", id)
    .maybeSingle();
  if (buscaError) return json({ erro: "Não foi possível localizar o agendamento." }, 500);
  if (!agendamento || agendamento.status !== "confirmado") return json({ erro: "Este agendamento não está mais pendente de assinatura." }, 409);

  const agora = agoraSaoPaulo();
  const dataAgendada = one((agendamento as any).datas)?.data ?? null;
  const horario = agendamento.horario_termos ? String(agendamento.horario_termos).slice(0, 5) : null;
  if (dataAgendada !== agora.data) return json({ erro: `A confirmação só pode ser realizada no dia agendado (${formatarData(dataAgendada) ?? "data não informada"}).` }, 409);
  if (horario && agora.hora < horario) return json({ erro: `A assinatura está agendada para ${horario}. Aguarde o horário marcado.` }, 409);

  const assinatura = new Date().toISOString();
  const cliente = one((agendamento as any).clientes);
  const liberacao = calcularLiberacaoCirurgica(assinatura, cliente?.custeio_confirmado_em ?? null);
  const { error } = await db.from("agendamentos").update({
    status: "realizado",
    termos_assinados_em: assinatura,
    previsao_liberacao_financeira: null,
    updated_at: new Date().toISOString(),
  }).eq("id", agendamento.id).eq("status", "confirmado");
  if (error) return json({ erro: "Não foi possível confirmar a assinatura." }, 500);

  await db.from("logs_alteracoes").insert({
    usuario: "admin_worker",
    acao: "confirmou_assinatura_termos",
    entidade: "agendamentos",
    entidade_id: agendamento.id,
    detalhes: {
      cliente_id: agendamento.cliente_id,
      termos_assinados_em: assinatura,
      custeio_confirmado_em: cliente?.custeio_confirmado_em ?? null,
      agenda_cirurgica_liberar_em: liberacao,
      regra: "termos_assinados + quitacao_confirmada + 5_dias_uteis",
    },
  });

  return json({
    ok: true,
    agendamentoId: agendamento.id,
    termosAssinadosEm: assinatura,
    agendaCirurgicaLiberarEm: liberacao,
    aguardandoQuitacao: !cliente?.custeio_confirmado_em,
  });
}

async function atualizarCiclo(request: Request, env: Env, agendamentoId: string) {
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await parseBody(request);
  const db = createServiceSupabaseClient(env);
  const { data: agendamento, error: erroAgendamento } = await db.from("agendamentos")
    .select("id,cliente_id,termos_assinados_em,previsao_liberacao_financeira")
    .eq("id", agendamentoId)
    .maybeSingle();
  if (erroAgendamento || !agendamento) return json({ erro: "Agendamento não encontrado." }, 404);

  const { data: cliente, error: erroCliente } = await db.from("clientes")
    .select("id,nome_completo,status_cirurgia,status_financeiro,custeio_confirmado_em")
    .eq("id", agendamento.cliente_id)
    .maybeSingle();
  if (erroCliente || !cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const updates: Record<string, unknown> = {};
  const detalhes: Record<string, unknown> = {};
  let custeioConfirmadoEm = cliente.custeio_confirmado_em as string | null;

  if (typeof body.custeioConfirmado === "boolean") {
    custeioConfirmadoEm = body.custeioConfirmado ? new Date().toISOString() : null;
    updates.custeio_confirmado_em = custeioConfirmadoEm;
    updates.status_financeiro = body.custeioConfirmado ? "pago" : "a_pagar";
    detalhes.custeioConfirmado = body.custeioConfirmado;
  }
  if (typeof body.cirurgiaRealizada === "boolean") {
    updates.status_cirurgia = body.cirurgiaRealizada ? "realizada" : "agendada";
    detalhes.cirurgiaRealizada = body.cirurgiaRealizada;
  }
  if (Object.keys(updates).length === 0) return json({ erro: "Nenhuma confirmação informada." }, 400);

  const { data: atualizado, error } = await db.from("clientes")
    .update(updates)
    .eq("id", cliente.id)
    .select("id,nome_completo,status_cirurgia,status_financeiro,custeio_confirmado_em")
    .single();
  if (error) return json({ erro: error.message }, 500);

  const liberacao = calcularLiberacaoCirurgica(agendamento.termos_assinados_em, custeioConfirmadoEm);
  await db.from("logs_alteracoes").insert({
    usuario: "admin_worker",
    acao: "atualizou_ciclo_liberacao",
    entidade: "clientes",
    entidade_id: cliente.id,
    detalhes: {
      ...detalhes,
      agendamento_id: agendamentoId,
      termos_assinados_em: agendamento.termos_assinados_em,
      custeio_confirmado_em: custeioConfirmadoEm,
      agenda_cirurgica_liberar_em: liberacao,
      previsao_liberacao_financeira: agendamento.previsao_liberacao_financeira,
    },
  });

  return json({
    cliente: atualizado,
    agendaCirurgicaLiberarEm: liberacao,
    agendaCirurgicaLiberada: Boolean(liberacao && liberacao <= agoraSaoPaulo().data),
    concluido: atualizado.status_cirurgia === "realizada",
  });
}

async function salvarDataCirurgia(request: Request, env: Env, agendamentoId: string) {
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await parseBody(request);
  const data = typeof body.previsaoLiberacaoFinanceira === "string" ? body.previsaoLiberacaoFinanceira : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json({ erro: "Informe uma data válida." }, 400);

  const db = createServiceSupabaseClient(env);
  const { data: agendamento } = await db.from("agendamentos")
    .select("id,cliente_id,termos_assinados_em,clientes(custeio_confirmado_em)")
    .eq("id", agendamentoId)
    .maybeSingle();
  if (!agendamento) return json({ erro: "Agendamento não encontrado." }, 404);
  const cliente = one((agendamento as any).clientes);
  const liberacao = calcularLiberacaoCirurgica(agendamento.termos_assinados_em, cliente?.custeio_confirmado_em ?? null);
  if (!liberacao) {
    if (!agendamento.termos_assinados_em) return json({ erro: "Os termos ainda não foram assinados." }, 409);
    return json({ erro: "A quitação do saldo ainda não foi confirmada." }, 409);
  }
  if (data < liberacao) return json({ erro: `Escolha uma data a partir de ${formatarData(liberacao)}.`, agendaCirurgicaLiberarEm: liberacao }, 409);

  const { error } = await db.rpc("agendar_cirurgia_data", { p_agendamento_id: agendamentoId, p_data: data });
  if (error) return erroAgendaCirurgica(error, liberacao);
  await db.from("logs_alteracoes").insert({
    usuario: "admin_worker",
    acao: "agendou_cirurgia",
    entidade: "agendamentos",
    entidade_id: agendamentoId,
    detalhes: { cliente_id: agendamento.cliente_id, data_cirurgia: data, agenda_cirurgica_liberar_em: liberacao },
  });
  return json({ ok: true, previsaoLiberacaoFinanceira: data, agendaCirurgicaLiberarEm: liberacao });
}

async function listarSolicitacoes(env: Env) {
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.from("solicitacoes_liberacao_financeira")
    .select("id,cliente_id,agendamento_id,forma_custeio,saldo_restante,taxa_cartao,total_com_taxa,status,observacao,created_at,updated_at,clientes(nome_completo,cpf,quantidade_parcelas,custeio_confirmado_em),agendamentos(previsao_liberacao_financeira,termos_assinados_em,datas(data))")
    .in("status", ["pendente", "em_analise", "aprovada"])
    .order("created_at", { ascending: true });
  if (error) return json({ erro: error.message }, 500);
  const solicitacoes = (data ?? [])
    .filter((item: any) => !one(item.agendamentos)?.previsao_liberacao_financeira)
    .map((item: any) => {
      const agendamento = one(item.agendamentos);
      const cliente = one(item.clientes);
      const dataTermos = one(agendamento?.datas)?.data ?? null;
      return {
        ...item,
        data_termos: dataTermos,
        previsao_sugerida: calcularLiberacaoCirurgica(agendamento?.termos_assinados_em ?? null, cliente?.custeio_confirmado_em ?? null),
      };
    });
  return json({ solicitacoes });
}

async function liberacaoInteligente(url: URL, env: Env) {
  const ano = Number(url.searchParams.get("ano"));
  const mes = Number(url.searchParams.get("mes"));
  const agendamentoId = url.searchParams.get("agendamento_id") || null;
  if (!ano || !mes || mes < 1 || mes > 12) return json({ erro: "Parâmetros obrigatórios: ano, mes" }, 400);

  const db = createServiceSupabaseClient(env);
  const hoje = agoraSaoPaulo().data;
  let clienteId: string | null = null;
  let cliente: any = null;

  if (agendamentoId) {
    const { data: ag, error } = await db.from("agendamentos")
      .select("id,cliente_id,valor_contrato,termos_assinados_em,clientes(id,nome_completo,valor_contrato,custeio_confirmado_em),datas(data)")
      .eq("id", agendamentoId)
      .maybeSingle();
    if (error || !ag) return json({ erro: "Agendamento não encontrado." }, 404);
    clienteId = ag.cliente_id;
    const relCliente = one((ag as any).clientes);
    const dataTermos = one((ag as any).datas)?.data ?? null;
    const liberacaoMinima = calcularLiberacaoCirurgica(ag.termos_assinados_em, relCliente?.custeio_confirmado_em ?? null);
    cliente = {
      id: clienteId,
      nome: relCliente?.nome_completo ?? "Cliente",
      valor: Number(ag.valor_contrato ?? 0),
      dataTermos,
      termosAssinadosEm: ag.termos_assinados_em ?? null,
      custeioConfirmadoEm: relCliente?.custeio_confirmado_em ?? null,
      agendaCirurgicaLiberarEm: liberacaoMinima,
    };
  }

  const { data: config } = await db.from("configuracoes").select("meta_orcamento_mensal").eq("id", 1).maybeSingle();
  const orcamentoMensal = Number(config?.meta_orcamento_mensal ?? 100000);
  const fim = ano + 2;
  const [{ data: liberadas }, { data: confirmadas }] = await Promise.all([
    db.from("datas_liberacao_financeira").select("data").eq("status", "disponivel").gte("data", `${ano}-01-01`).lte("data", `${fim}-12-31`),
    db.from("agendamentos").select("cliente_id,valor_contrato,previsao_liberacao_financeira,clientes(nome_completo)").not("previsao_liberacao_financeira", "is", null).gte("previsao_liberacao_financeira", `${ano}-01-01`).lte("previsao_liberacao_financeira", `${fim}-12-31`),
  ]);
  const disponibilizadas = new Set((liberadas ?? []).map((item: any) => item.data));
  const ocupadas = new Map<string, any>();
  const porMes = new Map<string, number>();
  for (const item of confirmadas ?? []) {
    const data = (item as any).previsao_liberacao_financeira as string | null;
    if (!data) continue;
    const relCliente = one((item as any).clientes);
    ocupadas.set(data, { nome: relCliente?.nome_completo ?? "Cliente", valor: Number(item.valor_contrato ?? 0), clienteId: item.cliente_id });
    if (!clienteId || item.cliente_id !== clienteId) porMes.set(data.slice(0, 7), (porMes.get(data.slice(0, 7)) ?? 0) + Number(item.valor_contrato ?? 0));
  }

  const analisar = (anoM: number, mesM: number) => {
    const total = new Date(anoM, mesM, 0).getDate();
    const mesStr = String(mesM).padStart(2, "0");
    const comprometido = porMes.get(`${anoM}-${mesStr}`) ?? 0;
    return Array.from({ length: total }, (_, index) => {
      const dia = index + 1;
      const data = `${anoM}-${mesStr}-${String(dia).padStart(2, "0")}`;
      const ocupante = ocupadas.get(data);
      const passado = data < hoje;
      const antesDaLiberacao = Boolean(cliente?.agendaCirurgicaLiberarEm && data < cliente.agendaCirurgicaLiberarEm);
      const disponibilizada = disponibilizadas.has(data);
      const depois = comprometido + (cliente?.valor ?? 0);
      const ultrapassagem = Math.max(0, depois - orcamentoMensal);
      const estado = passado || antesDaLiberacao ? "passado" : ocupante ? "vermelho" : !disponibilizada ? "cinza" : !cliente ? "verde" : depois <= orcamentoMensal ? "verde" : "amarelo";
      return {
        data,
        dia,
        estado,
        vagasDisponiveis: !passado && !antesDaLiberacao && !ocupante && disponibilizada,
        oracamentoAntes: comprometido,
        oracamentoDepois: cliente ? depois : comprometido,
        ultrapassagem,
        dentroOrcamento: depois <= orcamentoMensal,
        diasDisponibilizados: disponibilizada ? 1 : 0,
        ocupante: ocupante ? { nome: ocupante.nome, valor: ocupante.valor } : null,
      };
    });
  };

  const dias = analisar(ano, mes);
  let melhorData: any = null;
  const sugerida = cliente?.agendaCirurgicaLiberarEm as string | null | undefined;
  if (sugerida) {
    const [a, m, d] = sugerida.split("-").map(Number);
    const analiseMes = a === ano && m === mes ? dias : analisar(a, m);
    const dia = analiseMes.find((item: any) => item.data === sugerida);
    const antes = dia?.oracamentoAntes ?? (porMes.get(sugerida.slice(0, 7)) ?? 0);
    const depois = antes + cliente.valor;
    melhorData = {
      data: sugerida,
      dia: d,
      mes: m,
      ano: a,
      oracamentoMes: orcamentoMensal,
      comprometidoAntes: antes,
      valorCliente: cliente.valor,
      totalDepois: depois,
      dentroOrcamento: depois <= orcamentoMensal,
      motivo: "Primeiro dia elegível: 5 dias úteis após a conclusão de termos assinados e quitação confirmada.",
    };
  }
  const verdes = dias.filter((item: any) => item.estado === "verde").slice(0, 5).map((item: any) => ({ data: item.data, dia: item.dia, estado: "verde", oracamentoDepois: item.oracamentoDepois, ultrapassagem: 0, motivo: "Data disponível dentro do orçamento mensal" }));
  const amarelas = dias.filter((item: any) => item.estado === "amarelo").slice(0, 5).map((item: any) => ({ data: item.data, dia: item.dia, estado: "amarelo", oracamentoDepois: item.oracamentoDepois, ultrapassagem: item.ultrapassagem, motivo: `Ultrapassa o orçamento em ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.ultrapassagem)}.` }));
  return json({ cliente, orcamentoMensal, calendario: { ano, mes, dias }, melhorData, alternativas: { verdes, amarelas } });
}

export async function adminSurgeryFlow(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const ciclo = path.match(/^\/api\/admin\/agendamentos\/([^/]+)\/ciclo$/);
  const previsao = path.match(/^\/api\/admin\/agendamentos\/([^/]+)\/previsao$/);
  const managed = path === "/api/admin/agendamentos-termos"
    || path === "/api/admin/solicitacoes-liberacao-financeira"
    || path === "/api/admin/liberacao-inteligente"
    || Boolean(ciclo)
    || Boolean(previsao);
  if (!managed) return null;

  const denied = await exigirAdmin(request, env);
  if (denied) return denied;

  if (path === "/api/admin/agendamentos-termos") {
    if (request.method === "GET") return listarAgendamentosTermos(env);
    if (request.method === "POST") return confirmarAssinaturaTermos(request, env);
    return json({ erro: "Método não suportado." }, 405);
  }
  if (ciclo) {
    if (request.method !== "PATCH") return json({ erro: "Método não suportado." }, 405);
    return atualizarCiclo(request, env, decodeURIComponent(ciclo[1]));
  }
  if (previsao) {
    if (request.method !== "PATCH") return null;
    return salvarDataCirurgia(request, env, decodeURIComponent(previsao[1]));
  }
  if (path === "/api/admin/solicitacoes-liberacao-financeira" && request.method === "GET") return listarSolicitacoes(env);
  if (path === "/api/admin/liberacao-inteligente" && request.method === "GET") return liberacaoInteligente(url, env);
  return null;
}
