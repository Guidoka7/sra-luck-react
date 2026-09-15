import { createServiceSupabaseClient, type Env } from "./supabase";
import { getCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { integrationsStatusApi } from "./integrations-status";
import { pseudonymizeActorId, requestLogger, sanitizeLogValue } from "./logger";

const ADMIN_COOKIE = "admin_session";
const CLIENT_COOKIE = "cliente_session";
const MAX_BODY = 12_000;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

async function admin(request: Request, env: Env) {
  if (!env.CLIENTE_SESSION_SECRET) return false;
  return Boolean(await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET));
}

async function actorContext(request: Request, env: Env): Promise<{ actor_type: "admin" | "cliente" | "anonymous"; actor_id: string | null }> {
  if (!env.CLIENTE_SESSION_SECRET) return { actor_type: "anonymous", actor_id: null };
  const adminSession = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET);
  if (adminSession?.adminId) return { actor_type: "admin", actor_id: await pseudonymizeActorId(adminSession.adminId, env) };
  const clientSession = await verificarTokenSessao(getCookie(request, CLIENT_COOKIE), env.CLIENTE_SESSION_SECRET);
  if (clientSession?.clienteId) return { actor_type: "cliente", actor_id: await pseudonymizeActorId(clientSession.clienteId, env) };
  return { actor_type: "anonymous", actor_id: null };
}

function limparTexto(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

function nivelRecebido(value: unknown): "info" | "warn" | "error" | "fatal" {
  if (value === "info" || value === "warn" || value === "error" || value === "fatal") return value;
  if (value === "warning") return "warn";
  if (value === "critical") return "fatal";
  return "error";
}

export async function monitoramentoErros(request: Request, env: Env) {
  const integrationsStatus = await integrationsStatusApi(request, env);
  if (integrationsStatus) return integrationsStatus;

  const url = new URL(request.url);
  const log = requestLogger(request);

  // Compatibilidade para PWAs/bundles antigos ainda em cache. O domínio novo de
  // journey depende de tabelas que não fazem parte do schema de produção atual.
  // Responder 200 com contrato nulo faz o cliente antigo cair no fluxo legado
  // já existente sem gerar 500/404 no monitoramento.
  if (url.pathname === "/api/cliente/journey" && request.method === "GET") {
    return json({ contrato: null, legado: true });
  }

  if (url.pathname === "/api/cliente/app-telemetry" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Origem não autorizada." }, 403);

    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return json({ erro: "Evento muito grande." }, 413);

    // O componente vive no layout global e também roda antes do login. Nesse caso,
    // a telemetria deve ser apenas ignorada, sem gerar 401/404 no monitoramento.
    if (!env.CLIENTE_SESSION_SECRET) return json({ ok: true, ignored: true });
    const session = await verificarTokenSessao(getCookie(request, CLIENT_COOKIE), env.CLIENTE_SESSION_SECRET);
    if (!session?.clienteId) return json({ ok: true, ignored: true });

    let body: any;
    try { body = await request.json(); } catch { return json({ erro: "Evento inválido." }, 400); }

    const deviceKey = limparTexto(body?.deviceKey, 200);
    if (!deviceKey) return json({ erro: "Identificador do dispositivo ausente." }, 400);

    const now = new Date().toISOString();
    const db = createServiceSupabaseClient(env);
    const { data: existente, error: readError } = await db
      .from("cliente_app_devices")
      .select("pwa_installed_at,notifications_activated_at")
      .eq("cliente_id", session.clienteId)
      .eq("device_key", deviceKey)
      .maybeSingle();

    if (readError) {
      log.error("Falha ao consultar telemetria da cliente", { action: "telemetry.app.read", eventCode: "APP_TELEMETRY_READ_FAILED", statusCode: 503, error: readError });
      return json({ erro: "Não foi possível registrar a telemetria." }, 503);
    }

    const isPwaInstalled = Boolean(body?.isPwaInstalled);
    const pushActive = Boolean(body?.pushActive);
    const notificationPermission = limparTexto(body?.notificationPermission, 40) || "default";
    const payload: Record<string, unknown> = {
      cliente_id: session.clienteId,
      device_key: deviceKey,
      device_type: limparTexto(body?.deviceType, 40) || "unknown",
      display_mode: limparTexto(body?.displayMode, 40) || "browser",
      is_pwa_installed: isPwaInstalled,
      notification_permission: notificationPermission,
      push_active: pushActive,
      user_agent: limparTexto(sanitizeLogValue(request.headers.get("User-Agent")), 500),
      last_access_at: now,
      updated_at: now,
    };

    if (!existente) payload.first_access_at = now;
    if (isPwaInstalled && !existente?.pwa_installed_at) payload.pwa_installed_at = now;
    if (notificationPermission === "granted" && pushActive && !existente?.notifications_activated_at) payload.notifications_activated_at = now;

    const { error } = await db
      .from("cliente_app_devices")
      .upsert(payload, { onConflict: "cliente_id,device_key" });

    if (error) {
      log.error("Falha ao persistir telemetria da cliente", { action: "telemetry.app.persist", eventCode: "APP_TELEMETRY_PERSIST_FAILED", statusCode: 503, error });
      return json({ erro: "Não foi possível registrar a telemetria." }, 503);
    }

    return json({ ok: true });
  }

  if (url.pathname === "/api/monitoramento/erro" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ erro: "Origem não autorizada." }, 403);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return json({ erro: "Evento muito grande." }, 413);
    let body: any;
    try { body = await request.json(); } catch { return json({ erro: "Evento inválido." }, 400); }
    const mensagem = limparTexto(sanitizeLogValue(body?.mensagem), 1200);
    if (!mensagem) return json({ erro: "Mensagem ausente." }, 400);
    const origem = body?.origem === "api" ? "api" : body?.origem === "diagnostico" ? "diagnostico" : "frontend";
    const nivel = nivelRecebido(body?.nivel);
    const requestId = limparTexto(body?.request_id || request.headers.get("x-request-id"), 120);
    const detalhes = sanitizeLogValue(body?.detalhes && typeof body.detalhes === "object" ? body.detalhes : {});
    const actor = await actorContext(request, env);
    const durationMsRaw = Number(body?.duration_ms ?? body?.detalhes?.duracao_ms);
    const durationMs = Number.isFinite(durationMsRaw) && durationMsRaw >= 0 ? Math.round(durationMsRaw) : null;
    const db = createServiceSupabaseClient(env);
    const { error } = await db.from("monitoramento_erros").insert({
      origem,
      nivel,
      mensagem,
      action: limparTexto(sanitizeLogValue(body?.action), 200),
      actor_type: actor.actor_type,
      actor_id: actor.actor_id,
      duration_ms: durationMs,
      rota: limparTexto(sanitizeLogValue(body?.rota), 500),
      metodo: limparTexto(body?.metodo, 12),
      status_http: Number.isInteger(body?.status_http) ? body.status_http : null,
      codigo: limparTexto(body?.codigo, 120),
      stack: limparTexto(sanitizeLogValue(body?.stack), 5000),
      componente: limparTexto(sanitizeLogValue(body?.componente), 200),
      request_id: requestId,
      user_agent: limparTexto(sanitizeLogValue(request.headers.get("User-Agent")), 500),
      ambiente: limparTexto(body?.ambiente, 40) || "production",
      detalhes,
    });
    if (error) {
      log.error("Falha ao persistir evento de monitoramento", { action: "observability.event.persist", eventCode: "OBSERVABILITY_PERSIST_FAILED", statusCode: 503, error });
      return json({ erro: "Não foi possível registrar o evento." }, 503);
    }
    return json({ ok: true }, 201);
  }

  if (url.pathname === "/api/admin/monitoramento-erros" && request.method === "GET") {
    if (!(await admin(request, env))) return json({ erro: "Sessão administrativa expirada." }, 401);
    const db = createServiceSupabaseClient(env);
    const limite = Math.min(Math.max(Number(url.searchParams.get("limite") || 100), 1), 300);
    const { data: recentes, error } = await db.from("monitoramento_erros")
      .select("id,criado_em,origem,nivel,action,actor_type,actor_id,duration_ms,rota,metodo,status_http,codigo,mensagem,stack,componente,request_id,ambiente,detalhes")
      .order("criado_em", { ascending: false }).limit(limite);
    if (error) {
      log.error("Falha ao carregar eventos de monitoramento", { action: "observability.events.read", eventCode: "OBSERVABILITY_READ_FAILED", statusCode: 503, error });
      return json({ erro: "Não foi possível carregar o monitoramento." }, 503);
    }
    const agora = Date.now();
    const eventos = recentes ?? [];
    const dentro = (ms: number) => eventos.filter((e: any) => agora - new Date(e.criado_em).getTime() <= ms);
    const ult24 = dentro(24 * 60 * 60 * 1000);
    const ult1h = dentro(60 * 60 * 1000);
    const fatais = ult24.filter((e: any) => e.nivel === "fatal").length;
    const porRota = ult24.reduce((acc: Record<string, number>, e: any) => { const k = e.rota || "sem rota"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const topRotas = Object.entries(porRota).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([rota, total]) => ({ rota, total }));
    return json({
      geradoEm: new Date().toISOString(),
      resumo: { ultimaHora: ult1h.length, ultimas24h: ult24.length, fatais24h: fatais, criticos24h: fatais, totalCarregado: eventos.length },
      topRotas,
      eventos,
    });
  }

  if (url.pathname === "/api/admin/diagnostico" && request.method === "GET") {
    if (!(await admin(request, env))) return json({ erro: "Sessão administrativa expirada." }, 401);
    const db = createServiceSupabaseClient(env);
    const checks: Array<{ nome: string; ok: boolean; detalhe: string; ms: number }> = [];
    const probe = async (nome: string, fn: () => Promise<{ error: any }>) => {
      const inicio = Date.now();
      try {
        const result = await fn();
        checks.push({ nome, ok: !result.error, detalhe: result.error ? "Falha no serviço" : "OK", ms: Date.now() - inicio });
      } catch {
        checks.push({ nome, ok: false, detalhe: "Falha no serviço", ms: Date.now() - inicio });
      }
    };
    await probe("Supabase · clientes", async () => db.from("clientes").select("id", { count: "exact", head: true }));
    await probe("Supabase · boletos", async () => db.from("boletos").select("id", { count: "exact", head: true }));
    await probe("Supabase · agendamentos", async () => db.from("agendamentos").select("id", { count: "exact", head: true }));
    await probe("Supabase · datas", async () => db.from("datas").select("id", { count: "exact", head: true }));
    await probe("Supabase · liberações financeiras", async () => db.from("datas_liberacao_financeira").select("id", { count: "exact", head: true }));
    await probe("Supabase · monitoramento", async () => db.from("monitoramento_erros").select("id", { count: "exact", head: true }));
    return json({
      ok: checks.every((c) => c.ok),
      geradoEm: new Date().toISOString(),
      runtime: "cloudflare-workers",
      supabaseConfigurado: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      checks,
    });
  }
  return null;
}
