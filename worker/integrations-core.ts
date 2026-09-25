import { publicError } from "./http-security";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { buscarColaboradorAdminAtivo, PERMISSOES_ADMIN, temPermissaoAdmin } from "./admin-auth";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { CATALOGO_PROVEDORES, credenciaisApi, integracaoDesativada, obterCredencial, obterCredencialParaValidacao, salvarCredencialInterna } from "./integrations-credenciais";
import { garantirWebhooksRd, rdStationReadonlyApi } from "./rd-station-readonly";
import { validarConfiguracaoVapid, webPushConfigApi } from "./web-push-config";
import { pseudonymizeActorId, requestLogger } from "./logger";
import { rotinaAutorizada, testarGemini } from "./frase-do-dia";
import { caRequest, contaAzulApi, depsPadrao, ErroContaAzul, sincronizarContaAzul } from "./conta-azul";
import { importacaoAgendadaSeDevida } from "./crm-importacao";
import { catalogo, ESQUEMAS_CONFIG, salvarConfig } from "./integracoes-registro";
import { calcularEncargosAtraso } from "../src/lib/financeiro/encargos";

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
  const { encargos } = calcularEncargosAtraso(valorNominal, boleto.data_vencimento);
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
  const dataId = (new URL(request.url).searchParams.get("data.id") || new URL(request.url).searchParams.get("data_id") || "").toLowerCase();
  const parts = Object.fromEntries(signature.split(",").map((item) => item.trim().split("=")).filter(([k, v]) => k && v));
  const ts = parts.ts || "", v1 = parts.v1 || "";
  if (!dataId || !ts || !v1) return false;
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
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 512_000) return json({ erro: "Evento muito grande." }, 413);
  const paymentId = String(new URL(request.url).searchParams.get("data.id") || new URL(request.url).searchParams.get("data_id") || "");
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

  const dadosProvedor = { boleto_id: boleto.id, cliente_id: boleto.cliente_id, external_reference: externalReference || null, valor: Number.isFinite(valorPago) ? valorPago : null, status_provedor: statusProvedor, metodo: String(payment.payment_method_id || payment.payment_type_id || "cartao"), pago_em: pagoEm, payload: { id: paymentId, status: statusProvedor, transaction_amount: valorPago, date_approved: pagoEm } };
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

  const { error: integrationEventError } = await db.from("integracao_eventos").upsert({ provedor: "mercado_pago", event_id: paymentId, event_type: "payment_status", referencia: boleto.id, payload: dadosProvedor, status: "processado", processado_em: new Date().toISOString() }, { onConflict: "provedor,event_id", ignoreDuplicates: false });
  if (integrationEventError) log.warn("Webhook processado, mas evento de integração não foi persistido", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_INTEGRATION_EVENT_FAILED", error: integrationEventError });

  const { error: auditError } = await db.from("logs_alteracoes").insert({ usuario: "sistema:mercado_pago", acao: "recebeu_evento_mercado_pago", entidade: "boletos", entidade_id: boleto.id, detalhes: { paymentId, statusProvedor, transactionAmount: payment.transaction_amount ?? null, cliente_id: boleto.cliente_id, baixaAutomatica: false, aguardandoConferenciaHumana: statusProvedor === "approved" } });
  if (auditError) log.warn("Webhook processado, mas auditoria de negócio não foi persistida", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_AUDIT_LOG_FAILED", error: auditError });

  log.info("Webhook Mercado Pago processado", { entityType: "boleto", entityId: boleto.id, eventCode: "MP_WEBHOOK_PROCESSED", providerPaymentStatus: statusProvedor, awaitingHumanReview: statusProvedor === "approved" });
  return json({ ok: true, statusProvedor, aguardandoConferencia: statusProvedor === "approved", baixaAutomatica: false }, 200);
}

type ResultadoTesteIntegracao = {
  conectado: boolean;
  detalhe: string;
  latenciaMs: number;
  codigo?: string;
  tipoValidacao: "api_real" | "criptografica";
};

async function credenciaisObrigatoriasAusentes(env: Env, provedor: string) {
  const config = CATALOGO_PROVEDORES[provedor];
  if (!config) return ["Provedor desconhecido"];
  const ausentes: string[] = [];
  for (const campo of config.campos.filter((c) => c.obrigatorio)) {
    const valor = await obterCredencialParaValidacao(env, provedor, campo.chave);
    if (!valor?.trim()) ausentes.push(campo.label);
  }
  return ausentes;
}

async function testarProvedorReal(env: Env, provedor: string): Promise<ResultadoTesteIntegracao> {
  const inicio = Date.now();
  const finalizar = (parcial: Omit<ResultadoTesteIntegracao, "latenciaMs">): ResultadoTesteIntegracao => ({ ...parcial, latenciaMs: Date.now() - inicio });
  const ausentes = await credenciaisObrigatoriasAusentes(env, provedor);
  if (ausentes.length) return finalizar({
    conectado: false,
    detalhe: `Credenciais obrigatórias ausentes: ${ausentes.join(", ")}.`,
    codigo: "CREDENCIAL_AUSENTE",
    tipoValidacao: "api_real",
  });

  if (provedor === "mercado_pago") {
    const accessToken = await obterCredencialParaValidacao(env, "mercado_pago", "access_token");
    if (!accessToken) return finalizar({ conectado: false, detalhe: "Access Token não configurado.", codigo: "CREDENCIAL_AUSENTE", tipoValidacao: "api_real" });
    try {
      const response = await fetch("https://api.mercadopago.com/v1/payment_methods", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) return finalizar({ conectado: true, detalhe: "Mercado Pago autenticou o Access Token e respondeu à API real.", tipoValidacao: "api_real" });
      return finalizar({ conectado: false, detalhe: `Mercado Pago rejeitou a credencial (HTTP ${response.status}).`, codigo: response.status === 401 || response.status === 403 ? "AUTENTICACAO_RECUSADA" : "PROVEDOR_RECUSOU", tipoValidacao: "api_real" });
    } catch {
      return finalizar({ conectado: false, detalhe: "Falha de rede ao contatar o Mercado Pago.", codigo: "PROVEDOR_INDISPONIVEL", tipoValidacao: "api_real" });
    }
  }

  if (provedor === "gemini") {
    const apiKey = await obterCredencialParaValidacao(env, "gemini", "api_key");
    const modelo = await obterCredencialParaValidacao(env, "gemini", "modelo");
    if (!apiKey) return finalizar({ conectado: false, detalhe: "API Key do Gemini não configurada.", codigo: "CREDENCIAL_AUSENTE", tipoValidacao: "api_real" });
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({})) as any;
      if (!response.ok) return finalizar({ conectado: false, detalhe: `Google Gemini rejeitou a chave (HTTP ${response.status}).`, codigo: response.status === 400 || response.status === 401 || response.status === 403 ? "AUTENTICACAO_RECUSADA" : "PROVEDOR_RECUSOU", tipoValidacao: "api_real" });
      const nomes = Array.isArray(data?.models) ? data.models.map((m: any) => String(m?.name || "").replace(/^models\//, "")) : [];
      if (modelo && nomes.length && !nomes.includes(modelo.replace(/^models\//, ""))) {
        return finalizar({ conectado: false, detalhe: `A chave é válida, mas o modelo configurado "${modelo}" não está disponível para ela.`, codigo: "CONFIGURACAO_INVALIDA", tipoValidacao: "api_real" });
      }
      return finalizar({ conectado: true, detalhe: modelo ? `Gemini autenticado; modelo "${modelo}" disponível.` : "Gemini autenticado; a API listou os modelos disponíveis.", tipoValidacao: "api_real" });
    } catch {
      return finalizar({ conectado: false, detalhe: "Falha de rede ao contatar o Gemini.", codigo: "PROVEDOR_INDISPONIVEL", tipoValidacao: "api_real" });
    }
  }

  if (provedor === "web_push") {
    const [subject, publicKey, privateKey] = await Promise.all([
      obterCredencialParaValidacao(env, "web_push", "vapid_subject"),
      obterCredencialParaValidacao(env, "web_push", "vapid_public_key"),
      obterCredencialParaValidacao(env, "web_push", "vapid_private_key"),
    ]);
    if (!subject || !publicKey || !privateKey) return finalizar({ conectado: false, detalhe: "As três credenciais VAPID precisam estar configuradas.", codigo: "CREDENCIAL_AUSENTE", tipoValidacao: "criptografica" });
    const v = await validarConfiguracaoVapid({ subject, publicKey, privateKey });
    return finalizar(v.valido
      ? { conectado: true, detalhe: "Par VAPID validado criptograficamente: pública e privada pertencem ao mesmo par P-256.", tipoValidacao: "criptografica" }
      : { conectado: false, detalhe: v.detalhe, codigo: "CONFIGURACAO_INVALIDA", tipoValidacao: "criptografica" });
  }

  if (provedor === "rd_station") {
    const access = (await obterCredencialParaValidacao(env, "rd_station", "access_token"))
      || (await obterCredencialParaValidacao(env, "rd_station", "api_access_token"));
    if (!access) return finalizar({ conectado: false, detalhe: "RD Station ainda não possui Access Token autorizado. Conclua o OAuth.", codigo: "OAUTH_NAO_AUTORIZADO", tipoValidacao: "api_real" });
    try {
      const response = await fetch("https://api.rd.services/crm/v2/users?page[number]=1&page[size]=1", { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } });
      if (response.ok) return finalizar({ conectado: true, detalhe: "RD Station autenticou o token e respondeu à API CRM v2 em modo somente leitura.", tipoValidacao: "api_real" });
      return finalizar({ conectado: false, detalhe: `RD Station rejeitou o token (HTTP ${response.status}). Refaça o OAuth se necessário.`, codigo: response.status === 401 || response.status === 403 ? "AUTENTICACAO_RECUSADA" : "PROVEDOR_RECUSOU", tipoValidacao: "api_real" });
    } catch {
      return finalizar({ conectado: false, detalhe: "Falha de rede ao contatar o RD Station.", codigo: "PROVEDOR_INDISPONIVEL", tipoValidacao: "api_real" });
    }
  }

  if (provedor === "conta_azul") {
    const credenciais = {
      obter: (chave: string) => obterCredencialParaValidacao(env, "conta_azul", chave),
      salvar: (chave: string, valor: string, ator: string) => salvarCredencialInterna(env, "conta_azul", chave, valor, ator),
    };
    try {
      const r = await caRequest(depsPadrao(env, { credenciais }), "GET", "/v1/pessoas/conta-conectada") as Record<string, unknown>;
      return finalizar({ conectado: true, detalhe: `Conta Azul autenticada na empresa ${String(r?.nome_fantasia || r?.razao_social || "conectada")}.`, tipoValidacao: "api_real" });
    } catch (error) {
      const detalhe = error instanceof ErroContaAzul ? error.message : "Falha ao contatar a Conta Azul.";
      const codigo = error instanceof ErroContaAzul && [401, 403].includes(error.status) ? "AUTENTICACAO_RECUSADA" : error instanceof ErroContaAzul && error.retentavel ? "PROVEDOR_INDISPONIVEL" : "CONFIGURACAO_INVALIDA";
      return finalizar({ conectado: false, detalhe, codigo, tipoValidacao: "api_real" });
    }
  }

  return finalizar({ conectado: false, detalhe: "Este adaptador ainda não possui validação real implementada; por segurança, não pode ser ativado.", codigo: "VALIDACAO_REAL_INDISPONIVEL", tipoValidacao: "api_real" });
}

async function registrarTesteIntegracao(env: Env, usuario: string, provedor: string, resultado: ResultadoTesteIntegracao) {
  const db = createServiceSupabaseClient(env);
  await db.from("logs_alteracoes").insert({
    usuario,
    acao: "testou_conexao_integracao",
    entidade: "integracoes",
    entidade_id: provedor,
    detalhes: resultado,
  });
}

async function testarConexao(request: Request, env: Env) {
  const authorization = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS);
  if (authorization instanceof Response) return authorization;
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await request.json().catch(() => ({})) as { provedor?: string };
  const provedor = String(body.provedor || "");
  const resultado = await testarProvedorReal(env, provedor);
  await registrarTesteIntegracao(env, authorization.colaboradorId, provedor, resultado);
  requestLogger(request).info("Teste real de integração concluído", { eventCode: "INTEGRATION_REAL_TEST_COMPLETED", provider: provedor, connected: resultado.conectado, latencyMs: resultado.latenciaMs, code: resultado.codigo });
  return json(resultado, resultado.conectado ? 200 : 422);
}

async function alterarEstadoIntegracao(request: Request, env: Env) {
  const authorization = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS);
  if (authorization instanceof Response) return authorization;
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await request.json().catch(() => ({})) as { provedor?: string; ativo?: boolean };
  const provedor = String(body.provedor || "");
  if (typeof body.ativo !== "boolean" || !provedor) return json({ erro: "Informe provedor e estado ativo." }, 400);

  const db = createServiceSupabaseClient(env);
  if (!body.ativo) {
    const { error } = await db.from("integracoes_estado").upsert({ provedor, ativo: false, atualizado_por: authorization.colaboradorId, atualizado_em: new Date().toISOString() }, { onConflict: "provedor" });
    if (error) return json({ erro: "Não foi possível desativar a integração." }, 409);
    await db.from("logs_alteracoes").insert({ usuario: authorization.colaboradorId, acao: "desativou_integracao", entidade: "integracoes", entidade_id: provedor, detalhes: { validacaoReal: true } });
    return json({ ok: true, provedor, ativo: false });
  }

  const resultado = await testarProvedorReal(env, provedor);
  await registrarTesteIntegracao(env, authorization.colaboradorId, provedor, resultado);
  if (!resultado.conectado) {
    await db.from("integracoes_estado").upsert({ provedor, ativo: false, atualizado_por: authorization.colaboradorId, atualizado_em: new Date().toISOString() }, { onConflict: "provedor" });
    await db.from("logs_alteracoes").insert({ usuario: authorization.colaboradorId, acao: "falhou_ativacao_integracao", entidade: "integracoes", entidade_id: provedor, detalhes: resultado });
    return json({ erro: resultado.detalhe, codigo: resultado.codigo || "VALIDACAO_FALHOU", resultado, ativo: false }, 422);
  }

  const { error } = await db.from("integracoes_estado").upsert({ provedor, ativo: true, atualizado_por: authorization.colaboradorId, atualizado_em: new Date().toISOString() }, { onConflict: "provedor" });
  if (error) return json({ erro: "A validação passou, mas não foi possível persistir a ativação." }, 409);
  await db.from("logs_alteracoes").insert({ usuario: authorization.colaboradorId, acao: "ativou_integracao_validada", entidade: "integracoes", entidade_id: provedor, detalhes: resultado });
  return json({ ok: true, provedor, ativo: true, resultado });
}

/**
 * Agendador (pg_cron a cada 15 min, ou Vercel Cron): importação do CRM na frequência
 * configurada e sincronização da Conta Azul, cada uma só se estiver ligada.
 */
type BackgroundContext = { waitUntil?: (p: Promise<unknown>) => void };

async function cronIntegracoes(request: Request, env: Env, ctx?: BackgroundContext) {
  if (!rotinaAutorizada(request, env)) return json({ erro: "Não autorizado." }, 401);
  const resultado: Record<string, unknown> = {};

  try { resultado.rdWebhooks = await garantirWebhooksRd(env, "sistema:agendador"); }
  catch { resultado.rdWebhooks = { erro: "Falha ao garantir webhooks do RD Station." }; }

  const crm = importacaoAgendadaSeDevida(env);
  if (ctx?.waitUntil) {
    ctx.waitUntil(crm.then(() => undefined).catch(() => undefined));
    resultado.crm = { agendada: true, processamento: "segundo_plano" };
  } else {
    try { resultado.crm = await crm; } catch { resultado.crm = { erro: "Falha na importação agendada do CRM." }; }
  }

  try { resultado.contaAzul = await sincronizarContaAzul(env, { origem: "agendada", ator: "sistema:agendador" }); } catch { resultado.contaAzul = { erro: "Falha na sincronização da Conta Azul." }; }
  return json(resultado);
}

/** Padrão de integrações: registro + configuração por função + uso de hoje (sem segredos). */
async function catalogoApi(request: Request, env: Env) {
  const authorization = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS);
  if (authorization instanceof Response) return authorization;
  try {
    return json(await catalogo(env));
  } catch {
    return json({ erro: "Não foi possível montar o catálogo de integrações agora." }, 503);
  }
}

/** Grava a configuração (não secreta) de uma função, com versão e auditoria. */
async function salvarConfigApi(request: Request, env: Env) {
  const authorization = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS);
  if (authorization instanceof Response) return authorization;
  if (!sameOrigin(request)) return json({ erro: "Requisição de origem não autorizada." }, 403);
  const body = await request.json().catch(() => ({})) as { provedor?: unknown; funcao?: unknown; config?: unknown; versao?: unknown };
  if (ESQUEMAS_CONFIG[String(body.provedor)]?.[String(body.funcao)]?.permissao === "financeiro") {
    const financeiro = await requireAdminPermission(request, env, PERMISSOES_ADMIN.INTEGRACOES_OPERAR_FINANCEIRO);
    if (financeiro instanceof Response) return financeiro;
  }
  const r = await salvarConfig(env, body, authorization.colaboradorId);
  if (!r.ok) return json({ erro: r.erro, codigo: r.codigo }, r.status);
  requestLogger(request).info("Configuração de função de integração salva", { eventCode: "INTEGRATION_FUNCTION_CONFIGURED", provider: r.provedor, funcao: r.funcao, versao: r.versao });
  return json(r);
}

export async function integrationsApi(request: Request, env: Env, ctx?: BackgroundContext): Promise<Response | null> {
  const webPush = await webPushConfigApi(request, env);
  if (webPush) return webPush;
  const rd = await rdStationReadonlyApi(request, env, ctx);
  if (rd) return rd;
  const path = new URL(request.url).pathname;
  if (path === "/api/integrations/mercado-pago/webhook" && request.method === "POST") return handleMercadoPagoWebhook(request, env);
  if (path === "/api/cliente/payments/mercado-pago/preference" && request.method === "POST") return createMercadoPagoPreference(request, env);
  if (path === "/api/admin/integrations/credenciais") return credenciaisApi(request, env);
  if (path === "/api/admin/integrations/catalogo" && request.method === "GET") return catalogoApi(request, env);
  if (path === "/api/admin/integrations/config" && request.method === "POST") return salvarConfigApi(request, env);
  if (path === "/api/admin/integrations/testar-conexao" && request.method === "POST") return testarConexao(request, env);
  if (path === "/api/admin/integrations/estado" && request.method === "POST") return alterarEstadoIntegracao(request, env);
  if (path === "/api/cron/integracoes" && (request.method === "GET" || request.method === "POST")) return cronIntegracoes(request, env, ctx);
  const contaAzul = await contaAzulApi(request, env);
  if (contaAzul) return contaAzul;
  return null;
}
