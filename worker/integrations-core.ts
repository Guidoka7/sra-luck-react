import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";

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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function deepValues(value: unknown, bucket: { key: string; value: unknown }[] = [], prefix = ""): { key: string; value: unknown }[] {
  if (!value || typeof value !== "object") return bucket;
  if (Array.isArray(value)) {
    value.forEach((item, index) => deepValues(item, bucket, `${prefix}[${index}]`));
    return bucket;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child !== "object") bucket.push({ key: path.toLowerCase(), value: child });
    else deepValues(child, bucket, path);
  }
  return bucket;
}

function findField(payload: unknown, hints: string[]) {
  const entries = deepValues(payload);
  const normalized = hints.map((x) => x.toLowerCase());
  const exact = entries.find((entry) => normalized.some((hint) => entry.key.split(".").pop() === hint));
  if (exact) return exact.value;
  return entries.find((entry) => normalized.some((hint) => entry.key.includes(hint)))?.value;
}

function firstString(payload: unknown, hints: string[]) {
  const value = findField(payload, hints);
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function firstNumber(payload: unknown, hints: string[]) {
  const raw = firstString(payload, hints).replace(/\s/g, "").replace(/R\$/gi, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

async function requireAdmin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return null;
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET);
  return session?.adminId ?? null;
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

async function recordIntegrationEvent(db: ReturnType<typeof createServiceSupabaseClient>, input: {
  provedor: string; eventId?: string | null; eventType: string; referencia?: string | null; payload?: unknown; status?: string; error?: string | null;
}) {
  const row = {
    provedor: input.provedor,
    event_id: input.eventId || null,
    event_type: input.eventType,
    referencia: input.referencia || null,
    payload: input.payload || {},
    status: input.status || "processado",
    erro: input.error || null,
    processado_em: input.status === "erro" ? null : new Date().toISOString(),
  };
  if (row.event_id) {
    const { data, error } = await db.from("integracao_eventos").upsert(row, { onConflict: "provedor,event_id", ignoreDuplicates: true }).select("id").maybeSingle();
    return { data, error };
  }
  return db.from("integracao_eventos").insert(row).select("id").single();
}

async function handleRdWebhook(request: Request, env: Env) {
  if (!env.RD_WEBHOOK_SECRET) return json({ erro: "Webhook RD Station não configurado." }, 503);
  const supplied = request.headers.get("x-sra-luck-rd-key") || request.headers.get("x-rd-webhook-key") || "";
  if (!supplied || !timingSafeEqual(supplied, env.RD_WEBHOOK_SECRET)) return json({ erro: "Webhook não autorizado." }, 401);

  let payload: any;
  try { payload = await request.json(); } catch { return json({ erro: "JSON inválido." }, 400); }
  const eventName = String(payload?.event_name || "unknown");
  const transaction = String(payload?.transaction_uuid || "").trim() || null;
  const db = createServiceSupabaseClient(env);

  if (transaction) {
    const { data: existing } = await db.from("crm_vendas_entrada").select("id,status").eq("provedor", "rd_station").eq("transaction_uuid", transaction).maybeSingle();
    if (existing) return json({ ok: true, duplicate: true, id: existing.id }, 200);
  }

  const document = objectValue(payload?.document);
  const dealId = firstString(document, ["id", "deal_id", "negociacao_id"]) || null;
  const clientName = firstString(document, ["name", "nome", "contact_name", "nome_cliente"]) || null;
  const cpf = firstString(document, ["cpf", "document", "documento", "cpf_cliente"]).replace(/\D/g, "") || null;
  const email = firstString(document, ["email", "email_cliente"]) || null;
  const phone = firstString(document, ["phone", "telefone", "mobile_phone", "celular"]) || null;
  const campaign = firstString(document, ["campaign", "campanha", "campaign_name"]) || null;
  const source = firstString(document, ["source", "origem", "source_name"]) || null;
  const seller = firstString(document, ["user_name", "owner_name", "vendedor", "responsavel"]) || null;
  const contractValue = firstNumber(document, ["amount", "value", "valor", "valor_contrato", "valor da carta", "carta de credito"]);
  const modalityRaw = firstString(document, ["modalidade", "tipo_contrato", "contract_type"]);
  const modality = /100.*boleto/i.test(modalityRaw) ? "100_boleto" : /flex/i.test(modalityRaw) ? "flex" : null;
  const threshold = firstNumber(document, ["percentual_minimo", "percentual", "elegibilidade"]) || 60;

  const { data: staged, error: stageError } = await db.from("crm_vendas_entrada").insert({
    provedor: "rd_station",
    external_deal_id: dealId,
    transaction_uuid: transaction,
    event_name: eventName,
    cliente_nome: clientName,
    cliente_cpf: cpf,
    cliente_email: email,
    cliente_telefone: phone,
    campanha: campaign,
    origem: source,
    vendedor: seller,
    valor_contrato: contractValue,
    modalidade: modality,
    percentual_minimo: threshold,
    payload,
    status: "aguardando_conferencia",
  }).select("*").single();
  if (stageError) {
    await recordIntegrationEvent(db, { provedor: "rd_station", eventId: transaction, eventType: eventName, referencia: dealId, payload, status: "erro", error: stageError.message });
    return json({ erro: "Não foi possível registrar a venda recebida." }, 500);
  }

  await recordIntegrationEvent(db, { provedor: "rd_station", eventId: transaction, eventType: eventName, referencia: dealId, payload, status: "processado" });
  return json({ ok: true, recebido: true, entradaId: staged.id }, 200);
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
  if (!env.MERCADO_PAGO_ACCESS_TOKEN) return json({ erro: "Mercado Pago não configurado." }, 503);
  const body = await request.json().catch(() => ({})) as { boletoId?: string };
  const boletoId = String(body.boletoId || "");
  if (!boletoId) return json({ erro: "Parcela não informada." }, 400);
  const db = createServiceSupabaseClient(env);
  const { data: boleto, error } = await db.from("boletos")
    .select("id,cliente_id,numero_parcela,total_parcelas,valor,status,data_vencimento,suspensa,clientes(financeiro_taxa_cartao)")
    .eq("id", boletoId).eq("cliente_id", client).maybeSingle();
  if (error) return json({ erro: error.message }, 500);
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
    items: [{
      id: boleto.id,
      title: `Sra. Luck — Parcela ${boleto.numero_parcela}/${boleto.total_parcelas || ""}`,
      quantity: 1,
      currency_id: "BRL",
      unit_price: valorComTaxa,
    }],
    external_reference: `boleto:${boleto.id}`,
    back_urls: { success: `${base}/agenda?pagamento=sucesso`, pending: `${base}/agenda?pagamento=pendente`, failure: `${base}/agenda?pagamento=falha` },
    auto_return: "approved",
    notification_url: `${base}/api/integrations/mercado-pago/webhook`,
    statement_descriptor: "SRA LUCK",
    metadata: { boleto_id: boleto.id, cliente_id: client },
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(preference),
  });
  const mp = await response.json().catch(() => ({})) as any;
  if (!response.ok || !mp?.id || !mp?.init_point) {
    console.error("Falha ao criar preferência Mercado Pago:", response.status, mp);
    return json({ erro: "Não foi possível abrir o pagamento por cartão." }, 502);
  }
  return json({ preferenceId: mp.id, checkoutUrl: mp.init_point });
}

async function validateMercadoPagoSignature(request: Request, env: Env) {
  if (!env.MERCADO_PAGO_WEBHOOK_SECRET) return false;
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
  const computed = await hmacHex(env.MERCADO_PAGO_WEBHOOK_SECRET, manifest);
  return timingSafeEqual(computed, v1);
}

async function handleMercadoPagoWebhook(request: Request, env: Env) {
  if (!env.MERCADO_PAGO_ACCESS_TOKEN || !env.MERCADO_PAGO_WEBHOOK_SECRET) return json({ erro: "Mercado Pago não configurado." }, 503);
  if (!(await validateMercadoPagoSignature(request, env))) return json({ erro: "Assinatura inválida." }, 401);
  const payload = await request.json().catch(() => ({})) as any;
  const paymentId = String(new URL(request.url).searchParams.get("data.id") || payload?.data?.id || "");
  if (!paymentId) return json({ ok: true, ignored: true }, 200);
  const db = createServiceSupabaseClient(env);

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}` } });
  const payment = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    console.error("Falha ao consultar pagamento Mercado Pago:", response.status, payment);
    return json({ erro: "Falha ao confirmar pagamento no provedor." }, 502);
  }
  const externalReference = String(payment?.external_reference || "");
  const boletoId = externalReference.startsWith("boleto:") ? externalReference.slice(7) : String(payment?.metadata?.boleto_id || "");
  if (!boletoId) return json({ ok: true, ignored: true }, 200);

  const { data: boleto } = await db.from("boletos").select("id,cliente_id,valor,status").eq("id", boletoId).maybeSingle();
  if (!boleto) return json({ ok: true, ignored: true }, 200);

  const statusProvedor = String(payment.status || "unknown");
  await db.from("logs_alteracoes").insert({
    usuario: "sistema:mercado_pago",
    acao: "recebeu_evento_mercado_pago",
    entidade: "boletos",
    entidade_id: boleto.id,
    detalhes: { paymentId, statusProvedor, transactionAmount: payment.transaction_amount ?? null, cliente_id: boleto.cliente_id },
  });

  if (statusProvedor !== "approved") return json({ ok: true, statusProvedor }, 200);
  if (boleto.status === "pago") return json({ ok: true, duplicate: true }, 200);

  const valorPago = Number(payment.transaction_amount || 0);
  const jurosEEncargos = Math.max(0, Math.round((valorPago - Number(boleto.valor)) * 100) / 100);
  const dataPagamento = String(payment.date_approved || new Date().toISOString()).slice(0, 10);

  const { error: erroBaixa } = await db.rpc("financeiro_baixar_boleto", {
    p_boleto_id: boleto.id,
    p_data_pagamento: dataPagamento,
    p_juros: jurosEEncargos,
    p_multa: 0,
    p_desconto: 0,
    p_forma_pagamento: "cartao",
    p_instituicao_conta: "Mercado Pago",
    p_observacao: "Pagamento automático via Mercado Pago (cartão de crédito). Valor inclui encargos por atraso e taxa da maquininha, quando aplicável.",
    p_usuario: "sistema:mercado_pago",
    p_idempotency_key: `mercado_pago:${payment.id}`,
  });
  if (erroBaixa) {
    console.error("Falha ao baixar boleto via Mercado Pago:", erroBaixa.message);
    return json({ erro: "Não foi possível registrar o pagamento confirmado." }, 500);
  }
  return json({ ok: true }, 200);
}

async function contaAzulRequest(env: Env, path: string, init: RequestInit = {}) {
  if (!env.CONTA_AZUL_ACCESS_TOKEN) throw new Error("Conta Azul não configurado.");
  const response = await fetch(`https://api-v2.contaazul.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CONTA_AZUL_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Conta Azul HTTP ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

async function handleContaAzulAdmin(request: Request, env: Env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ erro: "Sessão administrativa expirada." }, 401);
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
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
      return json({ ok: true, resultado: result });
    } catch (error: any) {
      await db.from("conta_azul_operacoes").update({ status: "erro", erro: error?.message || "Erro Conta Azul", updated_at: new Date().toISOString() }).eq("id", op?.id);
      return json({ erro: "Falha ao sincronizar com Conta Azul." }, 502);
    }
  }

  if (path === "/api/admin/integrations/conta-azul/update-installment" && request.method === "POST") {
    const externalId = String(body.contaAzulParcelaId || "");
    const version = Number(body.versao);
    if (!externalId || !Number.isFinite(version)) return json({ erro: "ID e versão da parcela no Conta Azul são obrigatórios." }, 400);
    const patch = {
      nota: body.nota,
      descricao: body.descricao,
      vencimento: body.vencimento,
      composicao_valor: body.composicaoValor,
      versao: version,
      data_pagamento_esperado: body.dataPagamentoEsperado,
      metodo_pagamento: body.metodoPagamento,
      id_conta_financeira: body.contaFinanceiraId,
    };
    Object.keys(patch).forEach((key) => (patch as any)[key] === undefined && delete (patch as any)[key]);
    try {
      const result = await contaAzulRequest(env, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify(patch) });
      return json({ ok: true, resultado: result });
    } catch { return json({ erro: "Falha ao atualizar a parcela no Conta Azul." }, 502); }
  }

  return null;
}

export async function integrationsApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/integrations/rd-station/webhook" && request.method === "POST") return handleRdWebhook(request, env);
  if (path === "/api/integrations/mercado-pago/webhook" && request.method === "POST") return handleMercadoPagoWebhook(request, env);
  if (path === "/api/cliente/payments/mercado-pago/preference" && request.method === "POST") return createMercadoPagoPreference(request, env);
  if (path.startsWith("/api/admin/integrations/conta-azul/")) return handleContaAzulAdmin(request, env);
  return null;
}
