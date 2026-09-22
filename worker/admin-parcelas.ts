import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { ADMIN_COOKIE_NAME, getCookie, verificarTokenAdmin } from "./session";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";

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
      .select("id,nome_completo,valor_contrato,custo_total,taxa_administrativa_percentual,quantidade_parcelas,ativo,status_financeiro,updated_at")
      .eq("id", clienteId)
      .maybeSingle(),
  ]);
  if (error) return { resposta: json({ erro: publicError(error) }, 500), cliente: null, boletos: [] as any[] };
  if (clienteError) return { resposta: json({ erro: publicError(clienteError) }, 500), cliente: null, boletos: [] as any[] };
  if (!cliente) return { resposta: json({ erro: "Cliente não encontrada." }, 404), cliente: null, boletos: [] as any[] };

  return {
    resposta: null,
    cliente: {
      ...cliente,
      valor_contrato: cliente.valor_contrato == null ? null : Number(cliente.valor_contrato),
      custo_total: cliente.custo_total == null ? null : Number(cliente.custo_total),
      taxa_administrativa_percentual: cliente.taxa_administrativa_percentual == null ? null : Number(cliente.taxa_administrativa_percentual),
    },
    boletos: (boletos ?? []).map((boleto: any) => ({ ...boleto, valor: Number(boleto.valor) })),
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

  const taxaBruta = body.taxaPercentual ?? body.taxaAdministrativaPercentual;
  const taxa = taxaBruta === undefined || taxaBruta === null || taxaBruta === "" ? null : Number(taxaBruta);
  if (taxa !== null && (!Number.isFinite(taxa) || taxa < 0 || taxa > 999.99)) {
    return json({ erro: "Taxa administrativa inválida." }, 400);
  }

  const valorContrato = numeroPositivo(body.valorContrato ?? body.cartaCredito);
  if (body.valorContrato !== undefined && valorContrato === null) {
    return json({ erro: "Informe uma carta de crédito válida." }, 400);
  }

  const valorParcela = numeroPositivo(body.valorParcela ?? body.valor);
  const primeiroVencimento = String(body.primeiroVencimento ?? body.dataVencimento ?? "").trim() || null;
  if (primeiroVencimento && !dataValida(primeiroVencimento)) {
    return json({ erro: "Primeiro vencimento inválido." }, 400);
  }

  const [{ data: existentes, error: erroExistentes }, { data: clienteAtual, error: erroCliente }] = await Promise.all([
    db.from("boletos").select("id").eq("cliente_id", clienteId).limit(1),
    db.from("clientes").select("id,valor_contrato").eq("id", clienteId).maybeSingle(),
  ]);
  if (erroExistentes) return json({ erro: publicError(erroExistentes) }, 500);
  if (erroCliente) return json({ erro: publicError(erroCliente) }, 500);
  if (!clienteAtual) return json({ erro: "Cliente não encontrada." }, 404);

  const jaTinhaPlano = Boolean(existentes?.length);
  const cartaEfetiva = valorContrato ?? numeroPositivo(clienteAtual.valor_contrato);
  if (!cartaEfetiva) return json({ erro: "Informe a carta de crédito antes de criar o financeiro." }, 400);
  if (!jaTinhaPlano && !primeiroVencimento) {
    return json({ erro: "Informe o 1º vencimento para gerar o financeiro." }, 400);
  }

  if (valorContrato !== null && Math.abs(Number(clienteAtual.valor_contrato ?? 0) - valorContrato) > 0.009) {
    const { error: erroCarta } = await db.from("clientes").update({ valor_contrato: valorContrato }).eq("id", clienteId);
    if (erroCarta) return json({ erro: publicError(erroCarta) }, 500);
  }

  const { data, error } = await db.rpc("salvar_plano_financeiro_cliente", {
    p_cliente_id: clienteId,
    p_quantidade: quantidade,
    p_valor_parcela: valorParcela,
    p_primeiro_vencimento: primeiroVencimento,
    p_taxa_percentual: taxa,
    p_recalcular_abertas: body.recalcularAbertas !== false,
  });

  if (error) {
    const mensagem = String(error.message || "Não foi possível salvar o plano financeiro.")
      .replace(/^P0001:\s*/i, "")
      .replace(/^ERROR:\s*/i, "");
    const conflito = /parcela paga|em conferência|não é possível reduzir/i.test(mensagem);
    return json({ erro: conflito ? "Não é possível reduzir o plano com parcelas pagas ou em conferência." : publicError(error, "Não foi possível salvar o plano financeiro.") }, conflito ? 409 : 400);
  }

  const boletos = (data ?? []).map((boleto: any) => ({ ...boleto, valor: Number(boleto.valor) }));
  await db.from("logs_alteracoes").insert({
    usuario,
    acao: jaTinhaPlano || modo === "ajustar" ? "ajustou_plano_financeiro" : "criou_plano_financeiro",
    entidade: "clientes",
    entidade_id: clienteId,
    detalhes: {
      carta_credito: cartaEfetiva,
      quantidade_parcelas: quantidade,
      valor_parcela: valorParcela,
      primeiro_vencimento: primeiroVencimento,
      taxa_percentual: taxa,
      preservou_parcelas_pagas: true,
    },
  });
  await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: quantidade });

  return json({
    sucesso: true,
    boletos,
    parcelas: boletos,
    plano: { valorContrato: cartaEfetiva, quantidadeParcelas: quantidade, valorParcela, primeiroVencimento, taxaPercentual: taxa },
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

  if (request.method !== "GET") {
    try {
      const colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env);
      if (!colaborador || !temPermissaoAdmin(colaborador, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL)) {
        return json({ erro: "Seu papel não tem permissão para alterar o plano financeiro." }, 403);
      }
    } catch {
      return json({ erro: "Não foi possível validar sua permissão agora." }, 503);
    }
  }

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
    if (existentesError) return json({ erro: publicError(existentesError) }, 500);

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
    if (error) return json({ erro: publicError(error) }, 500);
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
      if (error) return json({ erro: publicError(error) }, 500);
      if (novoTotal > 0) await db.from("boletos").update({ total_parcelas: novoTotal }).eq("cliente_id", clienteId);
      await db.from("clientes").update({ quantidade_parcelas: novoTotal > 0 ? novoTotal : null }).eq("id", clienteId);
      await db.from("logs_alteracoes").insert({ usuario, acao: "excluiu_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, valor: atual.valor, vencimento: atual.data_vencimento, novo_total: novoTotal } });
      await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", quantidadeParcelas: novoTotal });
      return json({ sucesso: true, totalParcelas: novoTotal });
    }

    if (acao === "reabrir") {
      const { data, error } = await db.from("boletos").update({
        status: "nao_pago",
        data_pagamento: null,
        suspensa: false,
        suspensa_em: null,
        suspensa_por: null,
        observacoes: body.observacoes ?? atual.observacoes,
      }).eq("id", boletoId).eq("cliente_id", clienteId).select("*").single();
      if (error) return json({ erro: publicError(error) }, 500);
      await db.from("logs_alteracoes").insert({ usuario, acao: "reabriu_parcela", entidade: "clientes", entidade_id: clienteId, detalhes: { parcela: atual.numero_parcela, status_anterior: atual.status, estava_suspensa: Boolean(atual.suspensa), vencimento: atual.data_vencimento } });
      await avisarCliente(db, clienteId, { tipo: "parcela_atualizada", parcela: data.numero_parcela });
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
    if (error) return json({ erro: publicError(error) }, 500);
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
    if (error) return json({ erro: publicError(error) }, 500);
    return json({ sucesso: true, observacao: { id: data.id, texto, usuario, created_at: data.created_at } });
  }

  if (acao === "suspender") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return json({ erro: "Selecione ao menos uma parcela em aberto." }, 400);

    const { data: atuais, error } = await db.from("boletos")
      .select("id,status,numero_parcela,data_vencimento,suspensa")
      .eq("cliente_id", clienteId)
      .order("numero_parcela", { ascending: true });
    if (error) return json({ erro: publicError(error) }, 500);

    const selecionadas = (atuais ?? []).filter((boleto: any) => ids.includes(String(boleto.id)));
    if (selecionadas.length !== ids.length) return json({ erro: "Uma ou mais parcelas não pertencem a esta cliente." }, 400);
    if (selecionadas.some((boleto: any) => ["pago", "pendente_confirmacao"].includes(String(boleto.status)))) {
      return json({ erro: "Parcelas pagas ou em conferência não podem ser suspensas." }, 400);
    }

    const antes = new Map(selecionadas.map((boleto: any) => [String(boleto.id), {
      numero: Number(boleto.numero_parcela),
      vencimento: boleto.data_vencimento ?? null,
    }]));

    const { data: reorganizadas, error: erroSuspensao } = await db.rpc("suspender_realocar_parcelas_cliente", {
      p_cliente_id: clienteId,
      p_parcela_ids: ids,
      p_usuario: usuario,
    });
    if (erroSuspensao) return json({ erro: publicError(erroSuspensao, "Não foi possível suspender e realocar as parcelas.") }, 400);

    const realocadas = (reorganizadas ?? [])
      .filter((boleto: any) => ids.includes(String(boleto.id)))
      .map((boleto: any) => ({
        id: boleto.id,
        de_numero: antes.get(String(boleto.id))?.numero ?? null,
        para_numero: Number(boleto.numero_parcela),
        de_vencimento: antes.get(String(boleto.id))?.vencimento ?? null,
        para_vencimento: boleto.data_vencimento ?? null,
      }));

    await db.from("logs_alteracoes").insert({
      usuario,
      acao: "suspendeu_parcelas",
      entidade: "clientes",
      entidade_id: clienteId,
      detalhes: {
        parcelas: selecionadas.map((boleto: any) => boleto.numero_parcela),
        quantidade: ids.length,
        realocadas,
      },
    });
    await avisarCliente(db, clienteId, { tipo: "parcelamento_atualizado", suspensas: ids.length });
    return json({ sucesso: true, mensagem: `${ids.length} parcela(s) suspensa(s) e realocada(s) para o final do contrato.`, boletos: reorganizadas });
  }

  return json({ erro: "Ação inválida." }, 400);
}
