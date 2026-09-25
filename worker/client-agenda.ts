import { regrasOperacionais } from "./regras-operacionais";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenSessao } from "./session";
import { agoraSaoPaulo } from "./surgery-release";
import { requestContext } from "./request-context";

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
  const id = requestContext(request)?.clienteId;
  if (id) return { clienteId: id };
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
}

export async function agenda(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  const supabase = createServiceSupabaseClient(env, request);
  const clienteContexto = requestContext(request)?.cliente;
  const { data: cliente } = clienteContexto?.nome_completo !== undefined
    ? { data: clienteContexto }
    : await supabase.from("clientes")
    .select("id,nome_completo,procedimento,valor_contrato,quantidade_parcelas,status_revisao_financeira,financeiro_confirmado_em,financeiro_saldo_restante,financeiro_taxa_cartao,financeiro_total_com_taxa,financeiro_formas_custeio,custeio_confirmado_em,status_financeiro,status_cirurgia,data_atingiu_percentual,liberacao_financeira_solicitada_em")
    .eq("id", s.clienteId)
    .single();
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const hoje = agoraSaoPaulo().data;
  const { data: snapshot, error: erroSnapshot } = await supabase.rpc("loadtest_cliente_agenda_snapshot", {
    p_cliente_id: cliente.id, p_hoje: hoje,
  });
  if (erroSnapshot || !snapshot || typeof snapshot !== "object") {
    return json({ erro: "Não foi possível carregar a agenda agora." }, 503);
  }
  const { agendamentos, elegivel, solicitacao, datas_disponiveis: datasDisponiveis,
    remarcacoes, datas_cirurgia: datasCirurgia, data_minima: dataMinima,
    comprometido_por_mes: comprometidoPorMes } = snapshot as Record<string, any>;
  let ativo: any = (agendamentos ?? []).find((a: any) => a.status === "confirmado") ?? null;
  const concluido = (agendamentos ?? []).find((a: any) => a.status === "realizado") ?? null;
  // A liberação automática após os 5 dias úteis é processada pelo cron do
  // banco (migration_065). Este GET é estritamente somente leitura.
  const agendamentoCorrente: any = ativo ?? concluido ?? null;
  // Fonte de verdade da liberação é agendamentos.agenda_cirurgica_liberada_em
  // (gravado por agenda_tentar_liberar_cirurgia/agenda_cirurgica_liberar_manual
  // no backend) — nunca recalculado aqui.
  const agendaCirurgicaLiberarEm = agendamentoCorrente?.agenda_cirurgica_liberada_em ?? null;
  const cartaDeCredito = Number(agendamentoCorrente?.valor_contrato ?? cliente.valor_contrato ?? 0);

  // Produção: o backend sempre usa a data real de São Paulo. Nenhum cookie
  // ou controle do frontend pode alterar o relógio usado para disponibilidade.
  const datas = (datasDisponiveis ?? []).map((d: any) => ({
    id: d.id,
    data: d.data,
    vagasRestantes: d.vagas_restantes,
  }));

  const cirurgicaLiberada = Boolean(agendaCirurgicaLiberarEm) && !agendamentoCorrente?.data_cirurgia;
  let datasCirurgiaDisponiveis: Array<{ id: string; data: string; vagasRestantes: number }> = [];
  if (cirurgicaLiberada) {
    // V46 §17: a cliente não vê mês em que sua carta de crédito não caiba no
    // teto de R$ 100.000 — usa a mesma função SQL do backend
    // (agenda_comprometimento_mes), não uma soma recalculada aqui.
    // Regra interna (migration_076): só a partir da data dos termos + intervalo
    // configurado (padrão 90 dias). Antes disso, as datas não são enviadas e o
    // calendário da cliente as mostra como lotadas.
    const primeiraData = typeof dataMinima === "string" ? dataMinima.slice(0, 10) : null;
    datasCirurgiaDisponiveis = (datasCirurgia ?? [])
      .filter((d: any) => !primeiraData || String(d.data) >= primeiraData)
      .filter((d: any) => Number(comprometidoPorMes?.[String(d.data).slice(0, 7)] ?? 0) + cartaDeCredito <= regrasOperacionais().tetoMensalOperacional)
      .map((d: any) => ({
        id: d.id,
        data: d.data,
        vagasRestantes: d.vagas_restantes,
      }))
      .filter((d: { vagasRestantes: number }) => d.vagasRestantes > 0);
  }

  const mapAgendamento = (a: any) => a ? {
    id: a.id,
    data: a.datas?.data,
    horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null,
    termosAssinadosEm: a.termos_assinados_em ?? null,
    comparecimentoStatus: a.comparecimento_status ?? "pendente",
    quitacaoStatus: a.quitacao_status ?? "pendente",
    previsaoCirurgia: a.previsao_cirurgia ?? null,
    dataCirurgia: a.data_cirurgia ?? null,
    horarioCirurgia: a.horario_cirurgia ? String(a.horario_cirurgia).slice(0, 5) : null,
    status: a.status,
  } : null;

  return json({
    cliente: { id: cliente.id, nome: cliente.nome_completo, procedimento: cliente.procedimento },
    elegibilidade: {
      elegivel: Boolean(elegivel),
      // V46: atingir o percentual não move sozinha para Levantamentos. Fonte
      // de verdade é a coluna dedicada clientes.liberacao_financeira_
      // solicitada_em (gravada só por cliente_solicitar_liberacao_
      // financeira) — nunca status_revisao_financeira/financeiro_confirmado_
      // em, que são conceitos diferentes (julgamento do admin, não o clique
      // da cliente) e podem mudar por outros caminhos (ex.: reenvio após
      // "recusada" em worker/client-boletos.ts).
      liberacaoFinanceiraSolicitada: Boolean(cliente.liberacao_financeira_solicitada_em),
      liberacaoFinanceiraSolicitadaEm: cliente.liberacao_financeira_solicitada_em ?? null,
    },
    termosAguardandoNovaEscolha: Boolean(cliente.financeiro_confirmado_em) && !ativo,
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
    agendaCirurgicaLiberada: cirurgicaLiberada,
    dataTesteAtiva: null,
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

const HORARIOS_CIRURGIA_VALIDOS = new Set(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "14:00", "14:30", "15:00", "15:30", "16:00"]);

export async function agendarCirurgia(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const data = body?.data as string | undefined;
  const horario = body?.horario as string | undefined;
  if (!data || !dataValida(data)) return json({ erro: "Escolha a data da cirurgia." }, 400);
  if (!horario || !HORARIOS_CIRURGIA_VALIDOS.has(horario)) return json({ erro: "Escolha um horário válido." }, 400);

  const supabase = createServiceSupabaseClient(env);
  // agenda_reservar_cirurgia_cliente (migration_076) aplica o intervalo mínimo
  // após os termos e delega para agenda_reservar_cirurgia (migration_070), que
  // valida na mesma transação: agenda liberada, previsão como piso, capacidade
  // da data e o teto mensal de R$ 100.000 — nada disso é recalculado aqui.
  const { error } = await supabase.rpc("agenda_reservar_cirurgia_cliente", { p_cliente_id: s.clienteId, p_data: data, p_horario: horario, p_usuario: `cliente:${s.clienteId}` });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("AGENDA_CIRURGICA_NAO_LIBERADA")) return json({ erro: "Sua agenda cirúrgica ainda não foi liberada." }, 409);
    if (m.includes("ANTES_DA_PREVISAO")) return json({ erro: "Escolha uma data igual ou posterior à previsão confirmada pela equipe." }, 409);
    if (m.includes("DATA_CIRURGIA_LOTADA")) return json({ erro: "Essa data está lotada. Escolha outra data disponível." }, 409);
    if (m.includes("DATA_PASSADA")) return json({ erro: "Escolha uma data futura." }, 409);
    if (m.includes("DATA_CIRURGIA_INDISPONIVEL")) return json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, 409);
    if (m.includes("VAGAS_ESGOTADAS")) return json({ erro: "As vagas dessa data acabaram de se esgotar." }, 409);
    if (m.includes("HORARIO_OCUPADO")) return json({ erro: "Esse horário acabou de ser ocupado nessa data." }, 409);
    if (m.includes("HORARIO_INVALIDO")) return json({ erro: "Escolha um horário válido." }, 409);
    if (m.includes("TETO_MENSAL_EXCEDIDO")) return json({ erro: "O teto financeiro mensal para cirurgias já foi atingido nesse mês. Escolha outra data." }, 409);
    console.error("Falha ao confirmar data da cirurgia:", error);
    return json({ erro: "Não foi possível confirmar a data da cirurgia." }, 500);
  }
  return json({ ok: true, data, horario });
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
    if (erroAtualizacao) { console.error("Falha ao atualizar forma de custeio:", erroAtualizacao); return json({ erro: "Não foi possível salvar sua forma de pagamento." }, 500); }
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
  if (error) { console.error("Falha ao registrar forma de custeio:", error); return json({ erro: "Não foi possível salvar sua forma de pagamento." }, 500); }

  await supabase.from("logs_alteracoes").insert({
    usuario: `cliente:${cliente.id}`,
    acao: "escolheu_forma_custeio_saldo",
    entidade: "solicitacoes_liberacao_financeira",
    entidade_id: data.id,
    detalhes: { cliente_id: cliente.id, formaCusteio, saldoRestante, taxaCartao, totalComTaxa, agendamentoId: agendamentoAtivo?.id ?? null },
  });
  return json({ solicitacao: data });
}

export async function remarcarAgendamento(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  // A escolha cirúrgica confirmada é somente leitura no app da cliente.
  // O endpoint anterior de remarcação não deve aceitar pedidos dessa etapa.
  if (body?.tipo === "cirurgia") {
    return json({ erro: "A data da sua cirurgia já foi confirmada e não pode ser alterada pelo aplicativo." }, 409);
  }
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
    .select("id,data_id,horario_termos,termos_assinados_em,agenda_cirurgica_liberada_em,previsao_cirurgia,datas(data)")
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
    if (!(agendamento as any).agenda_cirurgica_liberada_em) return json({ erro: "Sua agenda cirúrgica ainda não foi liberada." }, 409);
    const previsao = (agendamento as any).previsao_cirurgia as string | null;
    if (previsao && dataEscolhida! < previsao) return json({ erro: `A cirurgia só pode ser agendada a partir de ${previsao.split("-").reverse().join("/")}.` }, 409);
    const { data: dataAlvo } = await supabase.from("datas_liberacao_financeira").select("id,data,status,fechamento_manual,vagas_totais").eq("data", dataEscolhida!).maybeSingle();
    if (!dataAlvo || dataAlvo.status !== "disponivel" || dataAlvo.fechamento_manual) return json({ erro: "Essa data não foi liberada pela equipe ou já não está disponível." }, 409);
    const { count } = await supabase.from("agendamentos").select("id", { count: "exact", head: true }).in("status", ["confirmado", "realizado"]).eq("data_cirurgia", dataEscolhida!).neq("id", agendamento.id);
    if ((count ?? 0) >= dataAlvo.vagas_totais) return json({ erro: "Essa data acabou de ser ocupada. Escolha outra data disponível." }, 409);
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
  if (error) { console.error("Falha ao registrar solicitação de remarcação:", error); return json({ erro: "Não foi possível enviar sua solicitação de alteração." }, 500); }

  return json({
    ok: true,
    solicitacao,
    mensagem: "Sua solicitação de alteração foi enviada para análise. O prazo é de até 5 dias úteis. Sua agenda atual permanece inalterada até a autorização.",
  });
}

/**
 * V46 — Etapa 1 (Elegibilidade e solicitação): atingir o percentual mínimo
 * de parcelas pagas NÃO move a cliente para Levantamentos sozinho. Só este
 * clique explícito, feito pela própria cliente no app, registra a
 * solicitação e move a cliente para a fila de Levantamentos no admin.
 *
 * Chama a RPC `cliente_solicitar_liberacao_financeira`
 * (migration_064_agenda_v46_regras_definitivas.sql), que grava em
 * `clientes.liberacao_financeira_solicitada_em` — coluna DEDICADA, não
 * compartilhada com `status_revisao_financeira`/`financeiro_confirmado_em`
 * (conceitos diferentes: julgamento do admin, não o clique da cliente).
 * Elegibilidade é revalidada no servidor dentro da RPC, nunca confiando em
 * nada enviado pelo cliente. Idempotente e concorrência-segura (a RPC usa
 * `for update`): duas chamadas simultâneas resultam em um único timestamp
 * e um único registro de auditoria.
 */
export async function solicitarLiberacaoEtapa1(request: Request, env: Env): Promise<Response> {
  const s = await sessao(request, env);
  if (!s) return json({ erro: "Sessão expirada." }, 401);

  const supabase = createServiceSupabaseClient(env);
  const jaSolicitadaAntes = await supabase.from("clientes").select("liberacao_financeira_solicitada_em").eq("id", s.clienteId).maybeSingle();
  const jaSolicitado = Boolean(jaSolicitadaAntes.data?.liberacao_financeira_solicitada_em);

  const { data: cliente, error } = await supabase.rpc("cliente_solicitar_liberacao_financeira", { p_cliente_id: s.clienteId });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("CLIENTE_NAO_ENCONTRADA")) return json({ erro: "Cliente não encontrada." }, 404);
    if (m.includes("PERCENTUAL_MINIMO_NAO_ATINGIDO")) return json({ erro: "Você ainda não atingiu a quantidade mínima de parcelas pagas para solicitar a liberação financeira." }, 409);
    console.error("Falha ao solicitar liberação financeira (Etapa 1):", error);
    return json({ erro: "Não foi possível registrar a solicitação." }, 500);
  }

  return json({ ok: true, liberacaoFinanceiraSolicitada: true, liberacaoFinanceiraSolicitadaEm: (cliente as any)?.liberacao_financeira_solicitada_em ?? null, jaSolicitado });
}
