import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { credenciaisApi, obterCredencial } from "./integrations-credenciais";
import { rdStationReadonlyApi } from "./rd-station-readonly";
import { webPushConfigApi } from "./web-push-config";
import { pseudonymizeActorId, requestLogger } from "./logger";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function timingSafeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
}

async function requireAdminPermission(request: Request, env: Env, permission: string): Promise<{ adminId: string; colaboradorId: string } | Response> {
  const adminId = await requireAdmin(request, env);
  if (!adminId) return json({ erro: "Sessão administrativa expirada." }, 401);
  try {
    const colaborador = await buscarColaboradorAdminAtivo(adminId, env);
    if (!colaborador || !temPermissaoAdmin(colaborador, permission)) {
      return json({ erro: "Seu papel não tem permissão para executar esta operação." }, 403);
    }
    return { adminId, colaboradorId: colaborador.id };
  } catch {
    return json({ erro: "Não foi possível validar sua permissão agora." }, 503);
  }
}

async function requireClient(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenSessao(getCookie(request, "cliente_session"), env.CLIENTE_SESSION_SECRET);
  return session?.clienteId ?? null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

function encargosPorAtraso(valor: number, dataVencimento: string) {
  const vencimento = new Date(`${dataVencimento}T00:00:00`);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diasEmAtraso = Math.max(0, Math.floor((hoje.getTime() - vencimento.getTime()) / 86_400_000));
  const juros = valor * diasEmAtraso * 0.002;
  const multa = valor * Math.ceil(diasEmAtraso / 30) * 0.02;
  return { diasEmAtraso, encargos: diasEmAtraso > 0 ? juros + multa : 0 };
}

async function createMercadoPagoPreference(request: Request, env: Env) {
  const client = await requireClient(request, env);
  if (!client) return json({ erro: "Sessão expirada." }, 401);
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const log = requestLogger(request).child({ actorType: "cliente", actorId: await pseudonymizeActorId(client, env), action: "payment.mercado_pago.preference.create", provider: "mercado_pago" });
  const accessToken = await obterCredencial(env, "mercado_pago", "access_token");
  if (!accessToken) {
    log.warn("Mercado Pago não configurado", { eventCode: "MP_NOT_CONFIGURED", statusCode: 503 });
    return json({ erro: "Mercado Pago não configurado." }, 503);
  }
  const body = await request.json().catch(() => ({})) as { boletoId?: string };
  const boletoId = String(body.boletoId || "");
  if (!boletoId) return json({ erro: "Parcela não informada." }, 400);
  const db = createServiceSupabaseClient(env);
  const { data: boleto, error } = await db.from("boletos")
    .select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,suspensa,clientes(financeiro_taxa_cartao)")
    .eq("id", boletoId).eq("cliente_id", client).maybeSingle();
  if (error) {
    log.error("Falha ao consultar parcela para checkout", { entityType: "boleto", entityId: boletoId, eventCode: "MP_BOLETO_LOOKUP_FAILED", statusCode: 500, error });
    return json({ erro: "Não foi possível validar a parcela." }, 500);
  }
  if (!boleto) return json({ erro: "Parcela não encontrada." }, 404);
  if (boleto.status === "pago") return json({ erro: "Essa parcela já está paga." }, 409);
  if (boleto.suspensa) return json({ erro: "Essa parcela está suspensa e não pode ser paga agora." }, 409);

  const valorNominal = Number(boleto.valor);
  const { encargos } = encargosPorAtraso(valorNominal, boleto.data_vencimento);
  const cliente = Array.isArray(boleto.clientes) ? boleto.clientes[0] : boleto.clientes;
  const taxaCartao = Number(cliente?.financeiro_taxa_cartao ?? 5.4);
  const valorComTaxa = Math.round((valorNominal + encargos) * (1 + taxaCartao / 100) * 100) / 100;

  const base = (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const preference = {
    items: [{ id: boleto.id, title: `Sra. Luck — Parcela ${boleto.numero_parcela}/${boleto.total_parcelas || ""}`, quantity: 1, currency_id: "BRL", unit_price: valorComTaxa }],
    external_reference: `boleto:${boleto.id}`,
    back_urls: { success: `${base}/agenda?pagamento=sucesso`, pending: `${base}/agenda?pagamento=pendente`, failure: `${base}/agenda?pagamento=falha` },
    auto_return: "approved",
    notification_url: `${base}/api/integrations/mercado-pago/webhook`,
    statement_descriptor: "SRA LUCK",
    metadata: { boleto_id: boleto.id, cliente_id: client },
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(preference),
  });
  const mp = await response.json().catch(() => ({})) as any;
  if (!response.ok || !mp?.id || !mp?.init_point) {
    log.error("Falha ao criar preferência Mercado Pago", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_PREFERENCE_FAILED", statusCode: 502, providerStatus: response.status });
    return json({ erro: "Não foi possível abrir o pagamento por cartão." }, 502);
  }
  log.info("Preferência Mercado Pago criada", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_PREFERENCE_CREATED" });
  return json({ preferenceId: mp.id, checkoutUrl: mp.init_point });
}

async function validateMercadoPagoSignature(request: Request, webhookSecret: string | null) {
  if (!webhookSecret) return false;
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const dataId = new URL(request.url).searchParams.get("data.id") || new URL(request.url).searchParams.get("data_id") || "";
  const parts = Object.fromEntries(signature.split(",").map((item) => item.trim().split("=")).filter(([k, v]) => k && v));
  const ts = parts.ts || "", v1 = parts.v1 || "";
  if (!ts || !v1) return false;
  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const computed = await hmacHex(webhookSecret, manifest);
  return timingSafeEqual(computed, v1);
}

async function handleMercadoPagoWebhook(request: Request, env: Env) {
  const log = requestLogger(request).child({ actorType: "system", action: "payment.mercado_pago.webhook", provider: "mercado_pago" });
  const accessToken = await obterCredencial(env, "mercado_pago", "access_token");
  const webhookSecret = await obterCredencial(env, "mercado_pago", "webhook_secret");
  if (!accessToken || !webhookSecret) return json({ erro: "Mercado Pago não configurado." }, 503);
  if (!(await validateMercadoPagoSignature(request, webhookSecret))) {
    log.warn("Webhook Mercado Pago com assinatura inválida", { eventCode: "MP_WEBHOOK_INVALID_SIGNATURE", statusCode: 401 });
    return json({ erro: "Assinatura inválida." }, 401);
  }
  const payload = await request.json().catch(() => ({})) as any;
  const paymentId = String(new URL(request.url).searchParams.get("data.id") || payload?.data?.id || "");
  if (!paymentId) return json({ ok: true, ignored: true }, 200);
  const db = createServiceSupabaseClient(env);

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payment = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    log.error("Falha ao consultar pagamento Mercado Pago", { eventCode: "MP_PAYMENT_LOOKUP_FAILED", statusCode: 502, providerStatus: response.status, externalPaymentId: paymentId });
    return json({ erro: "Falha ao confirmar pagamento no provedor." }, 502);
  }
  const externalReference = String(payment?.external_reference || "");
  const boletoId = externalReference.startsWith("boleto:") ? externalReference.slice(7) : String(payment?.metadata?.boleto_id || "");
  if (!boletoId) return json({ ok: true, ignored: true }, 200);

  const { data: boleto } = await db.from("boletos").select("id,cliente_id,valor,status,observacoes").eq("id", boletoId).maybeSingle();
  if (!boleto) return json({ ok: true, ignored: true }, 200);

  const statusProvedor = String(payment.status || "unknown");
  const valorPago = Number(payment.transaction_amount || 0);
  const pagoEm = payment.date_approved ? String(payment.date_approved) : null;
  const { data: existente } = await db.from("pagamentos_externos").select("id,status_validacao").eq("provedor", "mercado_pago").eq("external_payment_id", paymentId).maybeSingle();

  const dadosProvedor = { boleto_id: boleto.id, cliente_id: boleto.cliente_id, external_reference: externalReference || null, valor: Number.isFinite(valorPago) ? valorPago : null, status_provedor: statusProvedor, metodo: String(payment.payment_method_id || payment.payment_type_id || "cartao"), pago_em: pagoEm, payload: payment };
  if (existente) {
    const { error } = await db.from("pagamentos_externos").update(dadosProvedor).eq("id", existente.id);
    if (error) {
      log.error("Falha ao atualizar evento externo de pagamento", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_EXTERNAL_EVENT_UPDATE_FAILED", statusCode: 500, error });
      return json({ erro: "Não foi possível atualizar o evento externo." }, 500);
    }
  } else {
    const { error } = await db.from("pagamentos_externos").insert({ provedor: "mercado_pago", external_payment_id: paymentId, status_validacao: "aguardando_validacao", ...dadosProvedor });
    if (error) {
      log.error("Falha ao registrar evento externo de pagamento", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_EXTERNAL_EVENT_INSERT_FAILED", statusCode: 500, error });
      return json({ erro: "Não foi possível registrar o evento externo." }, 500);
    }
  }

  if (statusProvedor === "approved" && boleto.status !== "pago") {
    const marcador = `[Mercado Pago ${paymentId}]`;
    const atual = String(boleto.observacoes || "");
    const observacoes = atual.includes(marcador) ? atual : [atual, `${marcador} Pagamento aprovado pelo provedor; aguardando conferência humana.`].filter(Boolean).join("\n");
    const { error } = await db.from("boletos").update({ status: "pendente_confirmacao", observacoes }).eq("id", boleto.id).neq("status", "pago");
    if (error) log.error("Pagamento aprovado, mas parcela não entrou na fila humana", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_PENDING_CONFIRMATION_FAILED", error });
  }

  const { error: integrationEventError } = await db.from("integracao_eventos").upsert({ provedor: "mercado_pago", event_id: paymentId, event_type: "payment_status", referencia: boleto.id, payload: payment, status: "processado", processado_em: new Date().toISOString() }, { onConflict: "provedor,event_id", ignoreDuplicates: false });
  if (integrationEventError) log.warn("Webhook processado, mas evento de integração não foi persistido", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_INTEGRATION_EVENT_FAILED", error: integrationEventError });

  const { error: auditError } = await db.from("logs_alteracoes").insert({ usuario: "sistema:mercado_pago", acao: "recebeu_evento_mercado_pago", entidade: "boletos", entidade_id: boleto.id, detalhes: { paymentId, statusProvedor, transactionAmount: payment.transaction_amount ?? null, cliente_id: boleto.cliente_id, baixaAutomatica: false, aguardandoConferenciaHumana: statusProvedor === "approved" } });
  if (auditError) log.warn("Webhook processado, mas auditoria de negócio não foi persistida", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_AUDIT_LOG_FAILED", error: auditError });

  log.info("Webhook Mercado Pago processado", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_WEBHOOK_PROCESSED", providerPaymentStatus: statusProvedor, awaitingHumanReview: statusProvedor === "approved" });
  return json({ ok: true, statusProvedor, aguardandoConferencia: statusProvedor === "approved", baixaAutomatica: false }, 200);
}

async function contaAzulRequest(env: Env, path: string, init: RequestInit = {}) {
  if (!env.CONTA_AZUL_ACCESS_TOKEN) throw new Error("Conta Azul não configurado.");
  const response = await fetch(`https://api-v2.contaazul.com${path}`, { ...init, headers: { Authorization: `Bearer ${env.CONTA_AZUL_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Conta Azul HTTP ${response.status}`);
  return data;
}

async function handleContaAzulAdmin(request: Request, env: Env) {
  const authorization = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO);
  if (authorization instanceof Response) return authorization;
  const { adminId: admin, colaboradorId } = authorization;
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const log = requestLogger(request).child({ actorType: "admin", actorId: await pseudonymizeActorId(admin, env), action: "conta_azul.admin", provider: "conta_azul" });
  const url = new URL(request.url);
  const path = url.pathname;
  const db = createServiceSupabaseClient(env);
  const body = await request.json().catch(() => ({})) as any;

  if (path === "/api/admin/integrations/conta-azul/create-receivable" && request.method === "POST") {
    const boletoId = String(body.boletoId || "");
    const contaFinanceira = String(body.contaFinanceiraId || "");
    const contato = String(body.contatoId || "");
    if (!boletoId || !contaFinanceira || !contato) return json({ erro: "Parcela, contato e conta financeira são obrigatórios." }, 400);
    const { data: boleto, error } = await db.from("boletos").select("*, clientes(nome_completo), contratos_credito(codigo)").eq("id", boletoId).maybeSingle();
    if (error || !boleto) return json({ erro: "Parcela não encontrada." }, 404);
    const payload = {
      data_competencia: boleto.data_vencimento,
      valor: Number(boleto.valor),
      observacao: `Sra. Luck · ${boleto.contratos_credito?.codigo || boleto.id}`,
      descricao: `Parcela ${boleto.numero_parcela}/${boleto.total_parcelas || ""} · ${boleto.clientes?.nome_completo || "Cliente"}`,
      contato,
      conta_financeira: contaFinanceira,
      rateio: Array.isArray(body.rateio) ? body.rateio : [],
      condicao_pagamento: { parcelas: [{ descricao: `Parcela ${boleto.numero_parcela}/${boleto.total_parcelas || ""}`, data_vencimento: boleto.data_vencimento, nota: "Gerada pelo Sra. Luck", conta_financeira: contaFinanceira, detalhe_valor: { multa: 0, juros: 0, valor_bruto: Number(boleto.valor), valor_liquido: Number(boleto.valor), desconto: 0, taxa: 0 }, metodo_pagamento: "BOLETO_BANCARIO" }] },
    };
    const { data: op } = await db.from("conta_azul_operacoes").insert({ boleto_id: boletoId, contrato_credito_id: boleto.contrato_credito_id, tipo: "criar_receber", status: "enviado", request_payload: payload }).select("id").single();
    try {
      const result: any = await contaAzulRequest(env, "/v1/financeiro/eventos-financeiros/contas-a-receber", { method: "POST", body: JSON.stringify(payload) });
      await db.from("conta_azul_operacoes").update({ protocolo: result?.protocolo || null, status: result?.status === "ERROR" ? "erro" : "sucesso", response_payload: result, updated_at: new Date().toISOString() }).eq("id", op?.id);
      await db.from("logs_alteracoes").insert({
        usuario: colaboradorId,
        acao: "criou_recebivel_conta_azul",
        entidade: "boletos",
        entidade_id: boletoId,
        detalhes: { operacao_id: op?.id ?? null, protocolo: result?.protocolo ?? null },
      });
      return json({ ok: true, resultado: result });
    } catch (error) {
      await db.from("conta_azul_operacoes").update({ status: "erro", erro: error instanceof Error ? error.message : "Erro Conta Azul", updated_at: new Date().toISOString() }).eq("id", op?.id);
      log.error("Falha ao sincronizar conta a receber com Conta Azul", { entityType: "boleto", entityId: boletoId, eventCode: "CONTA_AZUL_RECEIVABLE_FAILED", statusCode: 502, error });
      return json({ erro: "Falha ao sincronizar com Conta Azul." }, 502);
    }
  }

  if (path === "/api/admin/integrations/conta-azul/update-installment" && request.method === "POST") {
    const externalId = String(body.contaAzulParcelaId || "");
    const version = Number(body.versao);
    if (!externalId || !Number.isFinite(version)) return json({ erro: "ID e versão da parcela no Conta Azul são obrigatórios." }, 400);
    const patch = { nota: body.nota, descricao: body.descricao, vencimento: body.vencimento, composicao_valor: body.composicaoValor, versao: version, data_pagamento_esperado: body.dataPagamentoEsperado, metodo_pagamento: body.metodoPagamento, id_conta_financeira: body.contaFinanceiraId };
    Object.keys(patch).forEach((key) => (patch as any)[key] === undefined && delete (patch as any)[key]);
    try {
      const result = await contaAzulRequest(env, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify(patch) });
      await db.from("logs_alteracoes").insert({
        usuario: colaboradorId,
        acao: "atualizou_parcela_conta_azul",
        entidade: "integracoes",
        entidade_id: externalId,
        detalhes: { campos: Object.keys(patch) },
      });
      return json({ ok: true, resultado: result });
    } catch (error) {
      log.error("Falha ao atualizar parcela no Conta Azul", { eventCode: "CONTA_AZUL_INSTALLMENT_UPDATE_FAILED", statusCode: 502, error });
      return json({ erro: "Falha ao atualizar a parcela no Conta Azul." }, 502);
    }
  }

  return null;
}

async function testarConexao(request: Request, env: Env) {
  const authorization = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS);
  if (authorization instanceof Response) return authorization;
  const { adminId: admin, colaboradorId } = authorization;
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await request.json().catch(() => ({})) as { provedor?: string };
  const provedor = String(body.provedor || "");
  const db = createServiceSupabaseClient(env);
  const log = requestLogger(request).child({ actorType: "admin", actorId: await pseudonymizeActorId(admin, env), action: "integration.connection.test", provider: provedor });

  let resultado: { conectado: boolean; detalhe: string };
  if (provedor === "mercado_pago") {
    const accessToken = await obterCredencial(env, "mercado_pago", "access_token");
    if (!accessToken) resultado = { conectado: false, detalhe: "Nenhum access token configurado." };
    else {
      try {
        const response = await fetch("https://api.mercadopago.com/v1/payment_methods", { headers: { Authorization: `Bearer ${accessToken}` } });
        resultado = response.ok ? { conectado: true, detalhe: "Token válido — API respondeu com sucesso." } : { conectado: false, detalhe: `Provedor rejeitou o token (HTTP ${response.status}).` };
      } catch {
        resultado = { conectado: false, detalhe: "Falha de rede ao contatar o provedor." };
      }
    }
  } else return json({ erro: "Teste de conexão ainda não implementado para este provedor." }, 501);

  const { error: auditError } = await db.from("logs_alteracoes").insert({ usuario: colaboradorId, acao: "testou_conexao_integracao", entidade: "integracoes", entidade_id: provedor, detalhes: resultado });
  if (auditError) log.warn("Teste de integração concluído, mas auditoria não foi persistida", { eventCode: "INTEGRATION_TEST_AUDIT_FAILED", error: auditError });
  log.info("Teste de integração concluído", { eventCode: "INTEGRATION_TEST_COMPLETED", connected: resultado.conectado });
  return json(resultado);
}

export async function integrationsApi(request: Request, env: Env): Promise<Response | null> {
  const webPush = await webPushConfigApi(request, env);
  if (webPush) return webPush;
  const rd = await rdStationReadonlyApi(request, env);
  if (rd) return rd;
  const path = new URL(request.url).pathname;
  if (path === "/api/integrations/mercado-pago/webhook" && request.method === "POST") return handleMercadoPagoWebhook(request, env);
  if (path === "/api/cliente/payments/mercado-pago/preference" && request.method === "POST") return createMercadoPagoPreference(request, env);
  if (path === "/api/admin/integrations/credenciais") return credenciaisApi(request, env);
  if (path === "/api/admin/integrations/testar-conexao" && request.method === "POST") return testarConexao(request, env);
  if (path.startsWith("/api/admin/integrations/conta-azul/")) return handleContaAzulAdmin(request, env);
  return null;
}
