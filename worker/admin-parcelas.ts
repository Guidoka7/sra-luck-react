import { createServiceSupabaseClient, type Env } from "./supabase";
import { ADMIN_COOKIE_NAME, getCookie, verificarTokenAdmin } from "./session";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function lerBody(request: Request): Promise<Record<string, any>> {
  try { return await request.json(); } catch { return {}; }
}

function dataValida(data: unknown) {
  return data === null || data === undefined || (typeof data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data));
}

function numeroPositivo(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const numero = Number(value);
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 100) / 100 : null;
}

function inteiro(value: unknown): number | null {
  const numero = Number(value);
  return Number.isInteger(numero) ? numero : null;
}

async function avisarCliente(db: ReturnType<typeof createServiceSupabaseClient>, clienteId: string, payload: Record<string, unknown>) {
  try {
    await db.channel(`notificacoes-cliente:${clienteId}`).send({ type: "broadcast", event: "nova_notificacao", payload });
  } catch (erro) {
    console.error("Falha no realtime das parcelas:", erro);
  }
}

async function listarPlano(db: ReturnType<typeof createServiceSupabaseClient>, clienteId: string) {
  const [{ data: boletos, error }, { data: cliente, error: clienteError }] = await Promise.all([
    db
      .from("boletos")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("numero_parcela", { ascending: true }),
    db
      .from("clientes")
      .select("id,nome_completo,valor_contrato,custo_total,taxa_administrativa_percentual,valor_total_plano,valor_parcela_plano,inicio_plano,forma_pagamento_plano,instituicao_pagamento,dia_cobranca,status_plano,quantidade_parcelas,percentual_minimo_agendar,ativo,status_financeiro,updated_at")
      .eq("id", clienteId)
      .maybeSingle(),
  ]);
  if (error) return { resposta: json({ erro: error.message }, 500), cliente: null, boletos: [] as any[] };
  if (clienteError) return { resposta: json({ erro: clienteError.message }, 500), cliente: null, boletos: [] as any[] };
  if (!cliente) return { resposta: json({ erro: "Cliente não encontrada." }, 404), cliente: null, boletos: [] as any[] };

  const boletoIds = (boletos ?? []).map((boleto: any) => String(boleto.id));
  const recebimentosPorBoleto = new Map<string, any>();
  if (boletoIds.length) {
    const { data: recebimentos, error: recebimentosError } = await db
      .from("financeiro_recebimentos")
      .select("boleto_id,valor_recebido,data_pagamento,forma_pagamento,instituicao_conta,instituicao_financeira,status_validacao,created_at")
      .in("boleto_id", boletoIds)
      .eq("status_validacao", "validado")
      .order("created_at", { ascending: false });
    if (recebimentosError) return { resposta: json({ erro: recebimentosError.message }, 500), cliente: null, boletos: [] as any[] };
    for (const recebimento of recebimentos ?? []) {
      const boletoId = String((recebimento as any).boleto_id);
      if (!recebimentosPorBoleto.has(boletoId)) recebimentosPorBoleto.set(boletoId, recebimento);
    }
  }

  return {
    resposta: null,
    cliente: {
      ...cliente,
      valor_contrato: cliente.valor_contrato == null ? null : Number(cliente.valor_contrato),
      custo_total: cliente.custo_total == null ? null : Number(cliente.custo_total),
      valor_total_plano: cliente.valor_total_plano == null ? null : Number(cliente.valor_total_plano),
      valor_parcela_plano: cliente.valor_parcela_plano == null ? null : Number(cliente.valor_parcela_plano),
      taxa_administrativa_percentual: cliente.taxa_administrativa_percentual == null ? null : Number(cliente.taxa_administrativa_percentual),
    },
    boletos: (boletos ?? []).map((boleto: any) => {
      const recebimento = recebimentosPorBoleto.get(String(boleto.id));
      return {
        ...boleto,
        valor: Number(boleto.valor),
        valor_recebido: recebimento?.valor_recebido == null ? null : Number(recebimento.valor_recebido),
        recebimento_data: recebimento?.data_pagamento ?? null,
        recebimento_forma: recebimento?.forma_pagamento ?? null,
        recebimento_instituicao: recebimento?.instituicao_financeira ?? recebimento?.instituicao_conta ?? null,
      };
    }),
  };
}

/**
 * Compatibilidade do drawer [FINANCEIRO].
 *
 * Historicamente o drawer enviava quantidadeParcelas/taxaPercentual/
 * primeiroVencimento/valorParcela para /boletos, enquanto a rota antiga
 * esperava totalParcelas/valor/dataVencimento. Isso fazia o plano nascer com
 * quantidade errada e, em alguns casos, sem vencimentos. A gravação agora é
 * centralizada na RPC transacional salvar_plano_financeiro_cliente.
 */
async function salvarPlanoDoDrawer(
  request: Request,
  env: Env,
  clienteId: string,
  usuario: string,
  modo: "criar" | "ajustar",
) {
  const db = createServiceSupabaseClient(env);
  const body = await lerBody(request);
  const quantidade = inteiro(body.quantidadeParcelas ?? body.totalParcelas ?? body.quantidade);
  if (!quantidade || quantidade < 1 || quantidade > 240) {
    return json({ erro: "Informe uma quantidade de parcelas entre 1 e 240." }, 400);
  }

  const valorContrato = numeroPositivo(body.valorContrato ?? body.cartaCredito);
  if (body.valorContrato !== undefined && valorContrato === null) {
    return json({ erro: "Informe uma carta de crédito válida." }, 400);
  }

  const valorParcela = numeroPositivo(body.valorParcela ?? body.valor);
  if (valorParcela === null) return json({ erro: "Informe um valor de parcela válido." }, 400);

  const primeiroVencimento = String(body.primeiroVencimento ?? body.inicioPlano ?? body.dataVencimento ?? "").trim() || null;
  if (primeiroVencimento && !dataValida(primeiroVencimento)) {
    return json({ erro: "Início do plano inválido." }, 400);
  }

  const novoModelo = body.valorTotalPlano !== undefined
    || body.formaPagamento !== undefined
    || body.instituicao !== undefined
    || body.diaCobranca !== undefined
    || body.statusPlano !== undefined;

  const [{ data: existentes, error: erroExistentes }, { data: clienteAtual, error: erroCliente }] = await Promise.all([
    db.from("boletos").select("id").eq("cliente_id", clienteId).limit(1),
    db.from("clientes").select("id,valor_contrato,custo_total,valor_total_plano").eq("id", clienteId).maybeSingle(),
  ]);
  if (erroExistentes) return json({ erro: erroExistentes.message }, 500);
  if (erroCliente) return json({ erro: erroCliente.message }, 500);
  if (!clienteAtual) return json({ erro: "Cliente não encontrada." }, 404);

  const jaTinhaPlano = Boolean(existentes?.length);
  if (!jaTinhaPlano && !primeiroVencimento) {
    return json({ erro: "Informe o início do plano para gerar as parcelas." }, 400);
  }

  if (valorContrato !== null && Math.abs(Number(clienteAtual.valor_contrato ?? 0) - valorContrato) > 0.009) {
    const { error: erroCarta } = await db.from("clientes").update({ valor_contrato: valorContrato }).eq("id", clienteId);
    if (erroCarta) return json({ erro: erroCarta.message }, 500);
  }

  let rpcName = "salvar_plano_financeiro_cliente";
  let rpcArgs: Record<string, unknown>;

  if (novoModelo) {
    const totalPlano = numeroPositivo(body.valorTotalPlano);
    if (body.valorTotalPlano === 0) {
      rpcArgs = {};
    }
    if (totalPlano === null && Number(body.valorTotalPlano) !== 0) {
      return json({ erro: "Informe um valor total do plano válido." }, 400);
    }
    const diaCobranca = inteiro(body.diaCobranca);
    if (body.diaCobranca !== undefined && (diaCobranca === null || diaCobranca < 1 || diaCobranca > 31)) {
      return json({ erro: "Dia de cobrança inválido." }, 400);
    }
    const statusPlano = String(body.statusPlano ?? "Ativa");
    if (!["Ativa", "Suspensa"].includes(statusPlano)) return json({ erro: "Status do plano inválido." }, 400);

    rpcName = "salvar_plano_financeiro_drawer";
    rpcArgs = {
      p_cliente_id: clienteId,
      p_quantidade: quantidade,
      p_valor_parcela: valorParcela,
      p_primeiro_vencimento: primeiroVencimento,
      p_valor_total_plano: Number(body.valorTotalPlano ?? clienteAtual.valor_total_plano ?? clienteAtual.custo_total ?? 0),
      p_forma_pagamento: body.formaPagamento == null ? null : String(body.formaPagamento),
      p_instituicao: body.instituicao == null ? null : String(body.instituicao),
      p_dia_cobranca: diaCobranca,
      p_status_plano: statusPlano,
      p_recalcular_abertas: body.recalcularAbertas !== false,
    };
  } else {
    const taxaBruta = body.taxaPercentual ?? body.taxaAdministrativaPercentual;
    const taxa = taxaBruta === undefined || taxaBruta === null || taxaBruta === "" ? null : Number(taxaBruta);
    if (taxa !== null && (!Number.isFinite(taxa) || taxa < 0 || taxa > 999.99)) {
      return json({ erro: "Taxa administrativa inválida." }, 400);
    }
    rpcArgs = {
      p_cliente_id: clienteId,
      p_quantidade: quantidade,
      p_valor_parcela: valorParcela,
      p_primeiro_vencimento: primeiroVencimento,
      p_taxa_percentual: taxa,
      p_recalcular_abertas: body.recalcularAbertas !== false,
    };
  }

  const { data, error } = await db.rpc(rpcName, rpcArgs);
  if (error) {
    const mensagem = String(error.message || "Não foi possível salvar o plano financeiro.")
      .replace(/^P0001:\s*/i, "")
      .replace(/^ERROR:\s*/i, "");
    return json({ erro: mensagem }, /parcela paga|em conferência|não é possível reduzir/i.test(mensagem) ? 409 : 400);
  }

  const boletos = (data ?? []).map((boleto: any) => ({ ...boleto, valor: Number(boleto.valor) }));
  await db.from("logs_alteracoes").insert({
    usuario,
    acao: jaTinhaPlano || modo === "ajustar" ? "ajustou_plano_financeiro" : "criou_plano_financeiro",
    entidade: "clientes",
    entidade_id: clienteId,
    detalhes: novoModelo ? {
      modelo: "drawer_v2",
      carta_credito: valorContrato ?? Number(clienteAtual.valor_contrato ?? 0),
      valor_total_plano: Number(body.valorTotalPlano ?? clienteAtual.valor_total_plano ?? clienteAtual.custo_total ?? 0),
      quantidade_parcelas: quantidade,
      valor_parcela: valorParcela,
      inicio_plano: primeiroVencimento,
      forma_pagamento: body.formaPagamento ?? null,
      instituicao: body.instituicao ?? null,
      dia_cobranca: body.diaCobranca ?? null,
      status_plano: body.statusPlano ?? "Ativa",
      preservou_parcelas_pagas: true,
    } : {
      modelo: "legado",
      carta_credito: valorContrato ?? Number(clienteAtual.valor_contrato ?? 0),
      quantidade_parcelas: quantidade,
      valor_parcela: valorParcela,
      primeiro_vencimento: primeiroVencimento,
      preservou_parcelas_pagas: true,
    },
  });
  await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: quantidade });

  const { data: clienteAtualizado } = await db
    .from("clientes")
    .select("id,valor_contrato,custo_total,valor_total_plano,valor_parcela_plano,inicio_plano,forma_pagamento_plano,instituicao_pagamento,dia_cobranca,status_plano,quantidade_parcelas,percentual_minimo_agendar")
    .eq("id", clienteId)
    .maybeSingle();

  return json({
    sucesso: true,
    boletos,
    parcelas: boletos,
    cliente: clienteAtualizado,
    plano: novoModelo ? {
      valorContrato: valorContrato ?? Number(clienteAtual.valor_contrato ?? 0),
      valorTotalPlano: Number(body.valorTotalPlano ?? clienteAtual.valor_total_plano ?? clienteAtual.custo_total ?? 0),
      quantidadeParcelas: quantidade,
      valorParcela,
      inicioPlano: primeiroVencimento,
      formaPagamento: body.formaPagamento ?? null,
      instituicao: body.instituicao ?? null,
      diaCobranca: body.diaCobranca ?? null,
      statusPlano: body.statusPlano ?? "Ativa",
    } : {
      valorContrato: valorContrato ?? Number(clienteAtual.valor_contrato ?? 0),
      quantidadeParcelas: quantidade,
      valorParcela,
      primeiroVencimento,
    },
  });
}

export async function adminParcelas(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/admin\/clientes\/([^/]+)\/(parcelas|boletos)$/);
  if (!match || !["GET", "POST", "PATCH"].includes(request.method)) return null;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  const sessao = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  if (!sessao) return json({ erro: "Sessão administrativa expirada." }, 401);

  const clienteId = decodeURIComponent(match[1]);
  const recurso = match[2] as "parcelas" | "boletos";
  const db = createServiceSupabaseClient(env);
  const usuario = `admin:${sessao.adminId}`;

  if (request.method === "GET") {
    const plano = await listarPlano(db, clienteId);
    if (plano.resposta) return plano.resposta;

    const { data: historico } = await db
      .from("logs_alteracoes")
      .select("*")
      .eq("entidade_id", clienteId)
      .in("acao", [
        "editou_parcela", "reabriu_parcela", "excluiu_parcela", "suspendeu_parcelas", "gerou_parcelas",
        "alterou_quantidade_parcelas", "registrou_observacao", "criou_plano_financeiro", "ajustou_plano_financeiro",
      ])
      .order("created_at", { ascending: false })
      .limit(100);

    return json({ cliente: plano.cliente, boletos: plano.boletos, parcelas: plano.boletos, historico: historico ?? [] });
  }

  // O drawer de Clientes usa /boletos como rota de criação/ajuste do plano.
  if (recurso === "boletos" && request.method === "POST") {
    return salvarPlanoDoDrawer(request, env, clienteId, usuario, "criar");
  }
  if (recurso === "boletos" && request.method === "PATCH") {
    return salvarPlanoDoDrawer(request, env, clienteId, usuario, "ajustar");
  }

  if (request.method !== "POST") return json({ erro: "Método não suportado." }, 405);

  const body = await lerBody(request);
  const acao = String(body.acao ?? "");

  // Fluxo avançado: "gerar" continua significando adicionar parcelas ao fim
  // do plano. O drawer de Clientes usa a operação transacional acima para
  // criar/ajustar a quantidade total do contrato.
  if (acao === "gerar") {
    const quantidade = Number(body.quantidade);
    const valorParcela = body.valorParcela === undefined || body.valorParcela === "" ? null : Number(body.valorParcela);
    const primeiroVencimento = body.primeiroVencimento || null;

    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 240) return json({ erro: "A quantidade deve ser um número inteiro entre 1 e 240." }, 400);
    if (valorParcela !== null && (!Number.isFinite(valorParcela) || valorParcela <= 0)) return json({ erro: "Valor da parcela inválido." }, 400);
    if (!dataValida(primeiroVencimento)) return json({ erro: "Data de vencimento inválida." }, 400);

    const { data: cliente } = await db.from("clientes").select("id,nome_completo,quantidade_parcelas,valor_contrato,custo_total").eq("id", clienteId).maybeSingle();
    if (!cliente) return json({ erro: "Cliente não encontrada." }, 404);

    const { data: existentes, error: existentesError } = await db
      .from("boletos")
      .select("numero_parcela,data_vencimento")
      .eq("cliente_id", clienteId)
      .order("numero_parcela", { ascending: false })
      .limit(1);
    if (existentesError) return json({ erro: existentesError.message }, 500);

    const ultima = Number(existentes?.[0]?.numero_parcela ?? 0);
    const total = ultima + quantidade;
    if (total > 240) return json({ erro: "O contrato não pode ultrapassar 240 parcelas." }, 400);

    const primeiro = primeiroVencimento || existentes?.[0]?.data_vencimento || new Date().toISOString().slice(0, 10);
    const totalBase = Number((cliente as any).custo_total ?? cliente.valor_contrato ?? 0);
    const valor = valorParcela ?? Number((totalBase / Math.max(total, 1)).toFixed(2));
    const rows = Array.from({ length: quantidade }, (_, index) => {
      const numero = ultima + index + 1;
      const base = new Date(`${primeiro}T00:00:00Z`);
      const dia = base.getUTCDate();
      base.setUTCDate(1);
      base.setUTCMonth(base.getUTCMonth() + (primeiroVencimento ? index : index + (ultima ? 1 : 0)));
      const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
      base.setUTCDate(Math.min(dia, ultimoDia));
      return {
        cliente_id: clienteId,
        numero_parcela: numero,
        total_parcelas: total,
        valor,
        data_vencimento: base.toISOString().slice(0, 10),
        status: "nao_pago",
      };
    });

    const { error } = await db.from("boletos").insert(rows);
    if (error) return json({ erro: error.message }, 500);
    await db.from("boletos").update({ total_parcelas: total }).eq("cliente_id", clienteId);
    await db.from("clientes").update({ quantidade_parcelas: total }).eq("id", clienteId);
    await db.from("logs_alteracoes").insert({ usuario, acao: "gerou_parcelas", entidade: "clientes", entidade_id: clienteId, detalhes: { quantidade_adicionada: quantidade, total_anterior: ultima, total_novo: total, valor_parcela: valor } });
    await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: total });
    return json({ sucesso: true, quantidadeAdicionada: quantidade, totalParcelas: total });
  }

  if (["reabrir", "excluir", "editar"].includes(acao)) {
    const boletoId = String(body.boletoId ?? "");
    if (!boletoId) return json({ erro: "Parcela não informada." }, 400);

    const { data: atual } = await db.from("boletos").select("*").eq("id", boletoId).eq("cliente_id", clienteId).maybeSingle();
    if (!atual) return json({ erro: "Parcela não encontrada." }, 404);
    if (atual.status === "pago") return json({ erro: "Parcelas pagas não podem ser alteradas." }, 400);

    if (acao === "excluir") {
      const { data: todas } = await db.from("boletos").select("id").eq("cliente_id", clienteId);
      const novoTotal = Math.max(0, (todas ?? []).length - 1);
      const { error } = await db.from("boletos").delete().eq("id", boletoId).eq("cliente_id", clienteId);
      if (error) return json({ erro: error.message }, 500);
      if (novoTotal > 0) await db.from("boletos").update({ total_parcelas: novoTotal }).eq("cliente_id", clienteId);
      await db.from("clientes").update({ quantidade_parcelas: novoTotal > 0 ? novoTotal : null }).eq("id", clienteId);
      await db.from("logs_alteracoes").insert({ usuario, acao: "excluiu_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, valor: atual.valor, vencimento: atual.data_vencimento, novo_total: novoTotal } });
      await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: novoTotal });
      return json({ sucesso: true, totalParcelas: novoTotal });
    }

    if (acao === "reabrir") {
      const { data, error } = await db.from("boletos").update({ status: "nao_pago", data_pagamento: null, observacoes: body.observacoes ?? atual.observacoes }).eq("id", boletoId).eq("cliente_id", clienteId).select("*").single();
      if (error) return json({ erro: error.message }, 500);
      await db.from("logs_alteracoes").insert({ usuario, acao: "reabriu_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, status_anterior: atual.status } });
      await avisarCliente(db, clienteId, { tipo: "parcela_atualizada", parcela: atual.numero_parcela });
      return json({ boleto: { ...data, valor: Number(data.valor) } });
    }

    const valor = body.valor === undefined || body.valor === "" ? undefined : Number(body.valor);
    const dataVencimento = body.dataVencimento === undefined ? undefined : (body.dataVencimento || null);
    if (valor !== undefined && (!Number.isFinite(valor) || valor <= 0)) return json({ erro: "Valor inválido." }, 400);
    if (!dataValida(dataVencimento)) return json({ erro: "Data de vencimento inválida." }, 400);
    if (valor === undefined && dataVencimento === undefined) return json({ erro: "Informe valor ou data de vencimento." }, 400);

    const update: Record<string, unknown> = {};
    if (valor !== undefined) update.valor = valor;
    if (dataVencimento !== undefined) update.data_vencimento = dataVencimento;
    const { data, error } = await db.from("boletos").update(update).eq("id", boletoId).eq("cliente_id", clienteId).select("*").single();
    if (error) return json({ erro: error.message }, 500);
    await db.from("logs_alteracoes").insert({ usuario, acao: "editou_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, de: { valor: atual.valor, data_vencimento: atual.data_vencimento }, para: { valor: data.valor, data_vencimento: data.data_vencimento } } });
    await avisarCliente(db, clienteId, { tipo: "parcela_atualizada", parcela: atual.numero_parcela });
    return json({ boleto: { ...data, valor: Number(data.valor) } });
  }

  if (acao === "registrar_observacao") {
    const texto = String(body.texto ?? "").trim();
    if (!texto) return json({ erro: "Escreva uma observação antes de salvar." }, 400);
    if (texto.length > 2000) return json({ erro: "Observação muito longa (máximo de 2000 caracteres)." }, 400);

    const { data, error } = await db
      .from("logs_alteracoes")
      .insert({ usuario, acao: "registrou_observacao", entidade: "clientes", entidade_id: clienteId, detalhes: { texto } })
      .select("id,created_at")
      .single();
    if (error) return json({ erro: error.message }, 500);
    return json({ sucesso: true, observacao: { id: data.id, texto, usuario, created_at: data.created_at } });
  }

  if (acao === "suspender") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return json({ erro: "Selecione ao menos uma parcela em aberto." }, 400);

    const { data: atuais, error } = await db.from("boletos").select("id,status,numero_parcela").eq("cliente_id", clienteId).order("numero_parcela", { ascending: true });
    if (error) return json({ erro: error.message }, 500);
    const selecionadas = (atuais ?? []).filter((boleto: any) => ids.includes(String(boleto.id)));
    if (selecionadas.length !== ids.length) return json({ erro: "Uma ou mais parcelas não pertencem a esta cliente." }, 400);
    if (selecionadas.some((boleto: any) => boleto.status === "pago")) return json({ erro: "Parcelas pagas nunca podem ser suspensas." }, 400);

    const agora = new Date().toISOString();
    const { error: erroSuspensao } = await db.from("boletos").update({ suspensa: true, suspensa_em: agora, suspensa_por: usuario }).in("id", ids).eq("cliente_id", clienteId).neq("status", "pago");
    if (erroSuspensao) return json({ erro: erroSuspensao.message }, 500);
    await db.from("logs_alteracoes").insert({ usuario, acao: "suspendeu_parcelas", entidade: "clientes", entidade_id: clienteId, detalhes: { parcelas: selecionadas.map((boleto: any) => boleto.numero_parcela), quantidade: ids.length } });
    await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", suspensas: ids.length });
    return json({ sucesso: true, mensagem: `${ids.length} parcela(s) suspensa(s).` });
  }

  return json({ erro: "Ação inválida." }, 400);
}
