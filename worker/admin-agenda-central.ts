import { buscarColaboradorAdminAtivo, exigirAdmin, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { agoraSaoPaulo } from "./surgery-release";
import { ADMIN_COOKIE_NAME, getCookie, verificarTokenAdmin } from "./session";
import { requiredPaid } from "./agenda-elegibilidade";

/**
 * V46 — Central de acompanhamento. Construído em cima da "Agenda
 * operacional definitiva" (migration_060-063, aplicada ao banco pela
 * branch feat/cliente-detail-drawer mas não commitada em main) + as
 * correções de migration_064_agenda_v46_regras_definitivas.sql (5 dias
 * úteis, elegibilidade tiered, solicitação explícita, teto reforçado,
 * responsável, pagamento final). Toda regra de negócio vive nas funções
 * SQL (agendar_data, agenda_confirmar_levantamento, agenda_confirmar_
 * previsao, agenda_registrar_comparecimento, agenda_registrar_quitacao,
 * agenda_tentar_liberar_cirurgia, agenda_reservar_cirurgia e as novas
 * desta migration) — este arquivo só busca dados, formata para o shell
 * novo e chama essas funções via RPC. Nenhuma regra é reimplementada aqui.
 *
 * Separado de worker/admin-surgery-flow.ts porque este último ainda
 * alimenta `/admin/visao-geral` e a linhagem histórica paralela
 * (agendar_cirurgia_data/previsao_liberacao_financeira, migration_028/039/
 * 041) — um domínio de dados genuinamente diferente, não "regra antiga" a
 * corrigir aqui.
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function one<T = any>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try { return (await request.json()) as Record<string, unknown>; } catch { return {}; }
}

function origemSegura(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function carregarSessaoAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  return verificarTokenAdmin(getCookie(request, ADMIN_COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
}

async function exigirPermissaoFinanceira(adminId: string, env: Env): Promise<Response | null> {
  try {
    const colaborador = await buscarColaboradorAdminAtivo(adminId, env);
    if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL)) {
      return json({ erro: "Seu papel não tem permissão para confirmar quitações ou pagamentos." }, 403);
    }
    return null;
  } catch {
    return json({ erro: "Não foi possível validar sua permissão agora." }, 503);
  }
}

async function exigirPermissaoAgenda(adminId: string, env: Env): Promise<Response | null> {
  try {
    const colaborador = await buscarColaboradorAdminAtivo(adminId, env);
    if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.AGENDA_GERENCIAR)) {
      return json({ erro: "Seu papel não tem permissão para gerenciar a agenda." }, 403);
    }
    return null;
  } catch {
    return json({ erro: "Não foi possível validar sua permissão agora." }, 503);
  }
}

function erroPadrao(error: any, mapa: Record<string, string>) {
  const mensagem = String(error?.message ?? "");
  for (const [codigo, texto] of Object.entries(mapa)) {
    if (mensagem.includes(codigo)) return json({ erro: texto }, 409);
  }
  console.error("Falha na Central de acompanhamento:", error);
  return json({ erro: "Não foi possível concluir a operação." }, 500);
}

const ERROS_CIRURGIA = {
  AGENDAMENTO_NAO_ENCONTRADO: "O agendamento não está mais disponível para alteração.",
  AGENDA_CIRURGICA_NAO_LIBERADA: "A agenda cirúrgica ainda não foi liberada para esta cliente.",
  ANTES_DA_PREVISAO: "A data escolhida é anterior à previsão cirúrgica confirmada.",
  DATA_PASSADA: "Escolha uma data futura.",
  DATA_CIRURGIA_INDISPONIVEL: "Essa data não foi liberada pela equipe ou já não está disponível.",
  VAGAS_ESGOTADAS: "As vagas dessa data acabaram de se esgotar.",
  HORARIO_OCUPADO: "Esse horário acabou de ser ocupado nessa data.",
  HORARIO_INVALIDO: "Escolha um horário válido.",
  TETO_MENSAL_EXCEDIDO: "O teto mensal de R$ 100.000,00 em carta de crédito para cirurgias já foi atingido nesse mês.",
  CIRURGIA_NAO_AGENDADA: "A cirurgia ainda não foi agendada.",
  PREVISAO_INVALIDA: "A previsão precisa ser igual ou posterior à data dos termos e não pode estar no passado.",
  DATA_TERMOS_NAO_ENCONTRADA: "Não foi possível localizar a data dos termos deste agendamento.",
  PERCENTUAL_MINIMO_NAO_ATINGIDO: "A cliente ainda não atingiu o percentual mínimo de parcelas pagas.",
  CONDICOES_NAO_ATENDIDAS: "Comparecimento e quitação precisam estar confirmados antes de liberar a agenda cirúrgica.",
  AJUSTE_PRAZO_INVALIDO: "O ajuste de prazo precisa ser 1, 3 ou 5 dias úteis.",
  PREVISAO_NAO_CONFIRMADA: "Confirme a previsão cirúrgica antes de registrar comparecimento/quitação.",
  FORMA_QUITACAO_NAO_ESCOLHIDA: "A cliente ainda não escolheu a forma de pagamento do saldo.",
  QUITACAO_JA_CONFIRMADA: "A quitação já havia sido confirmada.",
  DATA_INDISPONIVEL: "Essa data não está mais disponível.",
};


function prazoCirurgico(comparecimentoEm: string | null, quitacaoEm: string | null, ajusteDias: number): string | null {
  if (!comparecimentoEm || !quitacaoEm) return null;
  const base = comparecimentoEm.slice(0, 10) >= quitacaoEm.slice(0, 10) ? comparecimentoEm.slice(0, 10) : quitacaoEm.slice(0, 10);
  return adicionarDiasUteis(base, 5 + Math.max(0, ajusteDias || 0));
}
function adicionarDiasUteis(dataIso: string, dias: number): string {
  const [y, m, d] = dataIso.split("-").map(Number);
  const data = new Date(Date.UTC(y, m - 1, d));
  let adicionados = 0;
  while (adicionados < dias) {
    data.setUTCDate(data.getUTCDate() + 1);
    const wd = data.getUTCDay();
    if (wd !== 0 && wd !== 6) adicionados++;
  }
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(data.getUTCDate()).padStart(2, "0")}`;
}

// A liberação automática após o prazo V46 é processada pelo cron do banco
// (migration_065). GETs desta API são somente leitura: visualizar a Central
// nunca deve causar mutação de estado.

// ----------------------------------------------------------------------------
// Visão geral: 5 filas operacionais.
// ----------------------------------------------------------------------------
async function visaoGeral(env: Env) {
  const db = createServiceSupabaseClient(env);
  const hoje = agoraSaoPaulo().data;

  const { data: clientes, error: erroClientes } = await db.from("clientes")
    .select("id,nome_completo,cpf,procedimento,valor_contrato,quantidade_parcelas,status_revisao_financeira,financeiro_confirmado_em,data_atingiu_percentual,liberacao_financeira_solicitada_em,custeio_confirmado_em,status_cirurgia")
    .eq("ativo", true)
    .order("nome_completo", { ascending: true });
  if (erroClientes) return json({ erro: erroClientes.message }, 500);

  const clienteIds = (clientes ?? []).map((c: any) => c.id);
  const safeIds = clienteIds.length ? clienteIds : ["00000000-0000-0000-0000-000000000000"];
  const [{ data: agendamentosBrutos, error: erroAgendamentos }, { data: boletos }] = await Promise.all([
    db.from("agendamentos")
      .select("id,cliente_id,status,horario_termos,termos_assinados_em,termos_responsavel,comparecimento_status,comparecimento_em,quitacao_status,quitacao_em,previsao_cirurgia,previsao_cirurgia_confirmada_em,agenda_cirurgica_liberada_em,agenda_cirurgica_prazo_ajuste_dias,data_cirurgia,valor_contrato,pagamento_cirurgia_confirmado_em,processo_concluido_em,created_at,datas(data)")
      .in("cliente_id", safeIds)
      .in("status", ["confirmado", "realizado"])
      .order("created_at", { ascending: false }),
    db.from("boletos").select("cliente_id,status").in("cliente_id", safeIds),
  ]);
  if (erroAgendamentos) return json({ erro: erroAgendamentos.message }, 500);

  const agendamentos = agendamentosBrutos ?? [];

  const agendamentoPorCliente = new Map<string, any>();
  for (const a of agendamentos ?? []) {
    if (!agendamentoPorCliente.has(a.cliente_id)) agendamentoPorCliente.set(a.cliente_id, a);
  }
  const parcelasPorCliente = new Map<string, { total: number; pagas: number }>();
  for (const b of boletos ?? []) {
    const atual = parcelasPorCliente.get(b.cliente_id) ?? { total: 0, pagas: 0 };
    atual.total += 1;
    if (b.status === "pago") atual.pagas += 1;
    parcelasPorCliente.set(b.cliente_id, atual);
  }

  const filas = { preEligibility: [] as any[], financialReview: [] as any[], termsConfirmed: [] as any[], financialRelease: [] as any[], surgeryConfirmed: [] as any[] };

  for (const cliente of clientes ?? []) {
    const agendamento = agendamentoPorCliente.get(cliente.id) ?? null;
    const dataTermos = agendamento ? one(agendamento.datas)?.data ?? null : null;
    const parcelas = parcelasPorCliente.get(cliente.id) ?? { total: cliente.quantidade_parcelas ?? 0, pagas: 0 };
    const minimo = requiredPaid(parcelas.total || cliente.quantidade_parcelas || 12);
    const faltam = Math.max(0, minimo - parcelas.pagas);

    let estagio: keyof typeof filas;
    if (agendamento?.processo_concluido_em) {
      continue; // processo concluído sai das filas operacionais.
    } else if (agendamento?.data_cirurgia) {
      estagio = "surgeryConfirmed";
    } else if (dataTermos && dataTermos <= hoje) {
      estagio = "financialRelease";
    } else if (dataTermos) {
      estagio = "termsConfirmed";
    } else if (cliente.liberacao_financeira_solicitada_em != null) {
      // V46: SEM solicitação explícita, mesmo já elegível, a cliente
      // permanece em preEligibility — status_revisao_financeira/
      // financeiro_confirmado_em não são usados aqui de propósito (ver
      // comentário em migration_064 sobre por que são conceitos diferentes).
      estagio = "financialReview";
    } else {
      estagio = "preEligibility";
    }

    const cartao = {
      id: cliente.id,
      nome: cliente.nome_completo,
      cpf: cliente.cpf,
      procedimento: cliente.procedimento,
      liberacaoFinanceiraSolicitadaEm: cliente.liberacao_financeira_solicitada_em ?? null,
      cartaDeCredito: Number(agendamento?.valor_contrato ?? cliente.valor_contrato ?? 0),
      totalParcelas: parcelas.total || cliente.quantidade_parcelas || 0,
      parcelasPagas: parcelas.pagas,
      parcelasFaltantes: faltam,
      agendamentoId: agendamento?.id ?? null,
      dataTermos,
      horarioTermos: agendamento?.horario_termos ? String(agendamento.horario_termos).slice(0, 5) : null,
      termosResponsavel: agendamento?.termos_responsavel ?? null,
      comparecimentoStatus: agendamento?.comparecimento_status ?? "pendente",
      quitacaoStatus: agendamento?.quitacao_status ?? "pendente",
      previsaoCirurgia: agendamento?.previsao_cirurgia ?? null,
      previsaoConfirmadaEm: agendamento?.previsao_cirurgia_confirmada_em ?? null,
      agendaCirurgicaLiberadaEm: agendamento?.agenda_cirurgica_liberada_em ?? null,
      dataCirurgia: agendamento?.data_cirurgia ?? null,
      pagamentoCirurgiaConfirmadoEm: agendamento?.pagamento_cirurgia_confirmado_em ?? null,
      prazoCirurgico: agendamento ? prazoCirurgico(agendamento.comparecimento_em, agendamento.quitacao_em, agendamento.agenda_cirurgica_prazo_ajuste_dias ?? 0) : null,
    };
    filas[estagio].push(cartao);
  }

  filas.termsConfirmed.sort((a, b) => `${a.dataTermos ?? "9999"} ${a.horarioTermos ?? ""}`.localeCompare(`${b.dataTermos ?? "9999"} ${b.horarioTermos ?? ""}`));
  filas.financialRelease.sort((a, b) => `${a.dataTermos ?? "9999"} ${a.horarioTermos ?? ""}`.localeCompare(`${b.dataTermos ?? "9999"} ${b.horarioTermos ?? ""}`));
  filas.surgeryConfirmed.sort((a, b) => `${a.dataCirurgia ?? "9999"}`.localeCompare(`${b.dataCirurgia ?? "9999"}`));

  return json({ hoje, filas });
}

async function clienteCentral(env: Env, clienteId: string) {
  const db = createServiceSupabaseClient(env);
  const { data: cliente, error: erroCliente } = await db.from("clientes")
    .select("id,nome_completo,cpf,procedimento,valor_contrato,quantidade_parcelas,status_revisao_financeira,financeiro_confirmado_em,data_atingiu_percentual,liberacao_financeira_solicitada_em,custeio_confirmado_em,status_cirurgia")
    .eq("id", clienteId)
    .maybeSingle();
  if (erroCliente) return json({ erro: erroCliente.message }, 500);
  if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

  const [{ data: agendamentos }, { data: boletos }] = await Promise.all([
    db.from("agendamentos")
      .select("id,status,horario_termos,termos_assinados_em,termos_responsavel,comparecimento_status,comparecimento_em,quitacao_status,quitacao_em,previsao_cirurgia,previsao_cirurgia_confirmada_em,agenda_cirurgica_liberada_em,agenda_cirurgica_prazo_ajuste_dias,data_cirurgia,valor_contrato,pagamento_cirurgia_confirmado_em,processo_concluido_em,created_at,datas(data)")
      .eq("cliente_id", clienteId)
      .in("status", ["confirmado", "realizado"])
      .order("created_at", { ascending: false })
      .limit(1),
    db.from("boletos").select("status").eq("cliente_id", clienteId),
  ]);
  const agendamento: any = (agendamentos ?? [])[0] ?? null;
  const dataTermos = agendamento ? one(agendamento.datas)?.data ?? null : null;
  const total = (boletos ?? []).length || cliente.quantidade_parcelas || 0;
  const pagas = (boletos ?? []).filter((b: any) => b.status === "pago").length;
  const minimo = requiredPaid(total || 12);

  let estagio: string;
  if (agendamento?.processo_concluido_em) estagio = "concluido";
  else if (agendamento?.data_cirurgia) estagio = "surgeryConfirmed";
  else if (dataTermos && dataTermos <= agoraSaoPaulo().data) estagio = "financialRelease";
  else if (dataTermos) estagio = "termsConfirmed";
  else if (cliente.liberacao_financeira_solicitada_em != null) estagio = "financialReview";
  else estagio = "preEligibility";

  return json({
    estagio,
    cartao: {
      id: cliente.id,
      nome: cliente.nome_completo,
      cpf: cliente.cpf,
      procedimento: cliente.procedimento,
      liberacaoFinanceiraSolicitadaEm: cliente.liberacao_financeira_solicitada_em ?? null,
      cartaDeCredito: Number(agendamento?.valor_contrato ?? cliente.valor_contrato ?? 0),
      totalParcelas: total,
      parcelasPagas: pagas,
      parcelasFaltantes: Math.max(0, minimo - pagas),
      agendamentoId: agendamento?.id ?? null,
      dataTermos,
      horarioTermos: agendamento?.horario_termos ? String(agendamento.horario_termos).slice(0, 5) : null,
      termosResponsavel: agendamento?.termos_responsavel ?? null,
      comparecimentoStatus: agendamento?.comparecimento_status ?? "pendente",
      quitacaoStatus: agendamento?.quitacao_status ?? "pendente",
      previsaoCirurgia: agendamento?.previsao_cirurgia ?? null,
      previsaoConfirmadaEm: agendamento?.previsao_cirurgia_confirmada_em ?? null,
      agendaCirurgicaLiberadaEm: agendamento?.agenda_cirurgica_liberada_em ?? null,
      dataCirurgia: agendamento?.data_cirurgia ?? null,
      pagamentoCirurgiaConfirmadoEm: agendamento?.pagamento_cirurgia_confirmado_em ?? null,
      prazoCirurgico: agendamento ? prazoCirurgico(agendamento.comparecimento_em, agendamento.quitacao_em, agendamento.agenda_cirurgica_prazo_ajuste_dias ?? 0) : null,
    },
  });
}

// ----------------------------------------------------------------------------
// Aba Termos: calendário do mês + próximas assinaturas.
// ----------------------------------------------------------------------------
async function agendaTermos(url: URL, env: Env) {
  const db = createServiceSupabaseClient(env);
  const ano = Number(url.searchParams.get("ano")) || Number(agoraSaoPaulo().data.slice(0, 4));
  const mes = Number(url.searchParams.get("mes")) || Number(agoraSaoPaulo().data.slice(5, 7));
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const [{ data: datas, error: erroDatas }, { data: agendamentos, error: erroAgendamentos }] = await Promise.all([
    db.from("datas").select("id,data,vagas_totais,status,fechamento_manual").gte("data", inicio).lt("data", proximo).order("data", { ascending: true }),
    db.from("agendamentos")
      .select("id,cliente_id,data_id,horario_termos,termos_responsavel,status,clientes(nome_completo,cpf,procedimento),datas!inner(data)")
      .eq("status", "confirmado")
      .gte("datas.data", "2000-01-01"),
  ]);
  if (erroDatas) return json({ erro: erroDatas.message }, 500);
  if (erroAgendamentos) return json({ erro: erroAgendamentos.message }, 500);

  const porData = new Map<string, any[]>();
  for (const a of agendamentos ?? []) {
    const dataId = (a as any).data_id as string;
    const lista = porData.get(dataId) ?? [];
    lista.push(a);
    porData.set(dataId, lista);
  }

  const calendario = (datas ?? []).map((d: any) => ({
    id: d.id,
    data: d.data,
    vagasTotais: d.vagas_totais,
    status: d.fechamento_manual ? "bloqueado" : d.status,
    vagasOcupadas: (porData.get(d.id) ?? []).length,
  }));

  const proximasAssinaturas = (agendamentos ?? [])
    .map((a: any) => {
      const cliente = one(a.clientes);
      const dataAgendada = one(a.datas)?.data ?? null;
      return {
        agendamentoId: a.id,
        clienteId: a.cliente_id,
        nome: cliente?.nome_completo ?? "Cliente",
        cpf: cliente?.cpf ?? null,
        procedimento: cliente?.procedimento ?? null,
        data: dataAgendada,
        horario: a.horario_termos ? String(a.horario_termos).slice(0, 5) : null,
        responsavel: a.termos_responsavel ?? null,
      };
    })
    .filter((item: any) => item.data)
    .sort((a: any, b: any) => `${a.data} ${a.horario ?? ""}`.localeCompare(`${b.data} ${b.horario ?? ""}`));

  return json({ ano, mes, calendario, proximasAssinaturas });
}

// ----------------------------------------------------------------------------
// Aba Cirurgia: calendário do mês + mapa cirúrgico.
// ----------------------------------------------------------------------------
async function agendaCirurgia(url: URL, env: Env) {
  const db = createServiceSupabaseClient(env);
  const ano = Number(url.searchParams.get("ano")) || Number(agoraSaoPaulo().data.slice(0, 4));
  const mes = Number(url.searchParams.get("mes")) || Number(agoraSaoPaulo().data.slice(5, 7));
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const [{ data: datas, error: erroDatas }, { data: agendamentos, error: erroAgendamentos }, { data: comprometido, error: erroComprometido }] = await Promise.all([
    db.from("datas_liberacao_financeira").select("id,data,vagas_totais,status,fechamento_manual").gte("data", inicio).lt("data", proximo).order("data", { ascending: true }),
    db.from("agendamentos")
      .select("id,cliente_id,data_cirurgia,valor_contrato,pagamento_cirurgia_confirmado_em,processo_concluido_em,clientes(nome_completo,procedimento,custeio_confirmado_em)")
      .in("status", ["confirmado", "realizado"])
      .gte("data_cirurgia", inicio)
      .lt("data_cirurgia", proximo)
      .order("data_cirurgia", { ascending: true }),
    db.rpc("agenda_comprometimento_mes", { p_mes: inicio, p_excluir_cliente: null }),
  ]);
  if (erroDatas) return json({ erro: erroDatas.message }, 500);
  if (erroAgendamentos) return json({ erro: erroAgendamentos.message }, 500);
  if (erroComprometido) return json({ erro: erroComprometido.message }, 500);

  const porData = new Map<string, number>();
  for (const a of agendamentos ?? []) {
    const data = (a as any).data_cirurgia as string;
    porData.set(data, (porData.get(data) ?? 0) + 1);
  }
  const calendario = (datas ?? []).map((d: any) => ({
    id: d.id,
    data: d.data,
    vagasTotais: d.vagas_totais,
    status: d.fechamento_manual ? "bloqueado" : d.status,
    vagasOcupadas: porData.get(d.data) ?? 0,
  }));

  const mapaCirurgico = (agendamentos ?? []).map((a: any) => {
    const cliente = one(a.clientes);
    return {
      agendamentoId: a.id,
      clienteId: a.cliente_id,
      nome: cliente?.nome_completo ?? "Cliente",
      procedimento: cliente?.procedimento ?? null,
      data: a.data_cirurgia,
      cartaDeCredito: Number(a.valor_contrato ?? 0),
      quitada: Boolean(cliente?.custeio_confirmado_em),
      processoConcluido: Boolean(a.processo_concluido_em),
      pagamentoConfirmadoEm: a.pagamento_cirurgia_confirmado_em ?? null,
    };
  });

  return json({ ano, mes, calendario, mapaCirurgico, tetoMensal: 100000, comprometidoMensal: Number(comprometido ?? 0) });
}

// ----------------------------------------------------------------------------
// Ações administrativas (todas via RPC — a regra vive no banco).
// ----------------------------------------------------------------------------
async function rpcAction(env: Env, usuario: string, fn: string, args: Record<string, unknown>) {
  const db = createServiceSupabaseClient(env);
  return db.rpc(fn, { ...args, p_usuario: usuario });
}

async function definirResponsavelTermos(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  const responsavel = typeof body.responsavel === "string" ? body.responsavel.trim() : "";
  if (!agendamentoId || !responsavel) return json({ erro: "Informe o agendamento e o nome do responsável." }, 400);
  const { error } = await rpcAction(env, usuario, "agenda_definir_responsavel_termos", { p_agendamento_id: agendamentoId, p_responsavel: responsavel });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function liberarTermosParaNovaEscolha(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  if (!agendamentoId) return json({ erro: "Agendamento não informado." }, 400);
  const { error } = await rpcAction(env, usuario, "agenda_liberar_termos_para_nova_escolha", { p_agendamento_id: agendamentoId });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function reagendarTermosAgora(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoAtualId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  const novaDataId = typeof body.novaDataId === "string" ? body.novaDataId : "";
  const horario = typeof body.horario === "string" ? body.horario : "";
  if (!agendamentoAtualId || !novaDataId || !horario) return json({ erro: "Informe agendamento, nova data e horário." }, 400);
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.rpc("agenda_reagendar_termos_agora", { p_agendamento_atual_id: agendamentoAtualId, p_nova_data_id: novaDataId, p_horario_termos: horario, p_usuario: usuario });
  if (error) {
    return erroPadrao(error, {
      ...ERROS_CIRURGIA,
      CLIENTE_JA_AGENDADA: "A cliente já possui um agendamento confirmado.",
      VAGAS_ESGOTADAS: "As vagas dessa data acabaram de se esgotar.",
    });
  }
  return json({ ok: true, novoAgendamentoId: data });
}

async function confirmarPrevisao(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  const previsao = typeof body.previsao === "string" ? body.previsao : "";
  if (!agendamentoId || !/^\d{4}-\d{2}-\d{2}$/.test(previsao)) return json({ erro: "Informe o agendamento e uma data de previsão válida." }, 400);
  const db = createServiceSupabaseClient(env);
  const { error } = await db.rpc("agenda_confirmar_previsao", { p_agendamento_id: agendamentoId, p_previsao: previsao, p_usuario: usuario });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function registrarComparecimento(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  if (!agendamentoId) return json({ erro: "Agendamento não informado." }, 400);
  if (typeof body.compareceu !== "boolean") return json({ erro: "Informe explicitamente se a cliente compareceu." }, 400);
  const compareceu = body.compareceu;
  const db = createServiceSupabaseClient(env);
  const { error } = await db.rpc("agenda_registrar_comparecimento", { p_agendamento_id: agendamentoId, p_compareceu: compareceu, p_usuario: usuario });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function registrarQuitacao(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  if (!agendamentoId) return json({ erro: "Agendamento não informado." }, 400);
  if (typeof body.recebido !== "boolean") return json({ erro: "Informe explicitamente se a quitação foi recebida." }, 400);
  const recebido = body.recebido;
  const db = createServiceSupabaseClient(env);
  const idempotencyKey = `central-v46:${agendamentoId}:${Date.now()}`;
  const { error } = await db.rpc("agenda_registrar_quitacao", { p_agendamento_id: agendamentoId, p_recebido: recebido, p_usuario: usuario, p_idempotency_key: idempotencyKey });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function tentarLiberarCirurgia(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  if (!agendamentoId) return json({ erro: "Agendamento não informado." }, 400);
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.rpc("agenda_tentar_liberar_cirurgia", { p_agendamento_id: agendamentoId, p_usuario: usuario });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true, liberada: Boolean(data) });
}

async function ajustarPrazoCirurgico(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  const diasUteis = Number(body.diasUteis);
  if (!agendamentoId || ![1, 3, 5].includes(diasUteis)) return json({ erro: "Informe o agendamento e a quantidade de dias úteis (1, 3 ou 5)." }, 400);
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.rpc("agenda_cirurgica_ajustar_prazo", { p_agendamento_id: agendamentoId, p_dias_uteis: diasUteis, p_usuario: usuario });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true, novoPrazo: data });
}

async function liberarAgendaCirurgicaAgora(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  if (!agendamentoId) return json({ erro: "Agendamento não informado." }, 400);
  const { error } = await rpcAction(env, usuario, "agenda_cirurgica_liberar_manual", { p_agendamento_id: agendamentoId });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function agendarDataCirurgiaAdmin(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const clienteId = typeof body.clienteId === "string" ? body.clienteId : "";
  const data = typeof body.data === "string" ? body.data : "";
  const horario = typeof body.horario === "string" ? body.horario : "";
  if (!clienteId || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !horario) return json({ erro: "Informe cliente, data e horário válidos." }, 400);
  const db = createServiceSupabaseClient(env);
  const { error } = await db.rpc("agenda_reservar_cirurgia", { p_cliente_id: clienteId, p_data: data, p_horario: horario, p_usuario: usuario });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true, data });
}

async function confirmarPagamentoCirurgia(request: Request, env: Env, usuario: string) {
  const body = await parseBody(request);
  const agendamentoId = typeof body.agendamentoId === "string" ? body.agendamentoId : "";
  if (!agendamentoId) return json({ erro: "Agendamento não informado." }, 400);
  const { error } = await rpcAction(env, usuario, "agenda_confirmar_pagamento_cirurgia", { p_agendamento_id: agendamentoId });
  if (error) return erroPadrao(error, ERROS_CIRURGIA);
  return json({ ok: true });
}

async function abrirBloquearData(request: Request, env: Env, tabela: "datas" | "datas_liberacao_financeira") {
  const body = await parseBody(request);
  const data = typeof body.data === "string" ? body.data : "";
  const acao = body.acao;
  const vagas = Number(body.vagasTotais);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return json({ erro: "Informe uma data válida." }, 400);
  if (acao !== "liberar" && acao !== "bloquear") return json({ erro: "A ação deve ser liberar ou bloquear." }, 400);
  const bloquear = acao === "bloquear";
  const db = createServiceSupabaseClient(env);
  const payload: Record<string, unknown> = {
    data,
    status: "disponivel",
    fechamento_manual: bloquear,
  };
  if (Number.isFinite(vagas) && vagas > 0) payload.vagas_totais = vagas;
  const { data: atualizado, error } = await db.from(tabela).upsert(payload, { onConflict: "data" }).select("*").maybeSingle();
  if (error) return json({ erro: error.message }, 500);
  return json({ ok: true, data: atualizado });
}

export async function adminAgendaCentral(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/central/")) return null;

  const denied = await exigirAdmin(request, env);
  if (denied) return denied;

  const sessao = await carregarSessaoAdmin(request, env);
  if (!sessao) return json({ erro: "Sessão administrativa expirada." }, 401);
  if (request.method !== "GET" && !origemSegura(request)) {
    return json({ erro: "Origem da requisição não autorizada." }, 403);
  }
  const usuario = `admin:${sessao.adminId}`;

  if (path === "/api/admin/central/visao-geral" && request.method === "GET") return visaoGeral(env);
  const clienteMatch = path.match(/^\/api\/admin\/central\/cliente\/([^/]+)$/);
  if (clienteMatch && request.method === "GET") return clienteCentral(env, decodeURIComponent(clienteMatch[1]));
  if (path === "/api/admin/central/termos" && request.method === "GET") return agendaTermos(url, env);
  if (path === "/api/admin/central/cirurgia" && request.method === "GET") return agendaCirurgia(url, env);

  if (path === "/api/admin/central/termos/responsavel" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return definirResponsavelTermos(request, env, usuario);
  }
  if (path === "/api/admin/central/termos/devolver-escolha" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return liberarTermosParaNovaEscolha(request, env, usuario);
  }
  if (path === "/api/admin/central/termos/reagendar" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return reagendarTermosAgora(request, env, usuario);
  }
  if (path === "/api/admin/central/termos/data" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return abrirBloquearData(request, env, "datas");
  }

  if (path === "/api/admin/central/previsao" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return confirmarPrevisao(request, env, usuario);
  }
  if (path === "/api/admin/central/comparecimento" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return registrarComparecimento(request, env, usuario);
  }
  if (path === "/api/admin/central/quitacao" && request.method === "POST") {
    const semPermissao = await exigirPermissaoFinanceira(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return registrarQuitacao(request, env, usuario);
  }
  if (path === "/api/admin/central/liberar-tentativa" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return tentarLiberarCirurgia(request, env, usuario);
  }
  if (path === "/api/admin/central/prazo/ajustar" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return ajustarPrazoCirurgico(request, env, usuario);
  }
  if (path === "/api/admin/central/prazo/liberar-agora" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return liberarAgendaCirurgicaAgora(request, env, usuario);
  }

  if (path === "/api/admin/central/cirurgia/agendar" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return agendarDataCirurgiaAdmin(request, env, usuario);
  }
  if (path === "/api/admin/central/cirurgia/pagamento" && request.method === "POST") {
    const semPermissao = await exigirPermissaoFinanceira(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return confirmarPagamentoCirurgia(request, env, usuario);
  }
  if (path === "/api/admin/central/cirurgia/data" && request.method === "POST") {
    const semPermissao = await exigirPermissaoAgenda(sessao.adminId, env);
    if (semPermissao) return semPermissao;
    return abrirBloquearData(request, env, "datas_liberacao_financeira");
  }

  return null;
}
