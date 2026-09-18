import { createServiceSupabaseClient, type Env } from "./supabase";
import { criarTokenAdmin, criarTokenSessao, getCookie, setAdminSessionCookie, setSessionCookie, clearAdminSessionCookie, clearSessionCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { buscarColaboradorAdminAtivo, exigirAdmin } from "./admin-auth";
import { agenda, agendar, agendarCirurgia, remarcarAgendamento, solicitarLiberacaoFinanceira, json as apiJson } from "./client-agenda";
import { clienteAgendamentoAcao, adminAgendamentoAcao } from "./agendamento-acoes";
import { handleClienteBoletos } from "./client-boletos";
import { clientPushApi } from "./client-push";
import { adminVisaoGeral } from "./admin-visao-geral";
import { adminApi } from "./admin-api";
import { adminParcelas } from "./admin-parcelas";
import { adminNotificacoes } from "./admin-notificacoes";
import { adminFinance } from "./admin-finance";
import { adminReports } from "./admin-reports";
import { adminRelatorios } from "./admin-relatorios";
import { adminSurgeryFlow } from "./admin-surgery-flow";
import { adminAgenda } from "./admin-agenda";
import { monitoramentoErros } from "./monitoramento-erros";
import { creditOpsApi } from "./credit-ops";
import { journeyApi } from "./journey";
import { clientNotificacoesApi } from "./client-notificacoes";
import { clientConfigApi } from "./client-config";
import { staffApi } from "./staff-api";
import { integrationsApi } from "./integrations-core";
import { adminNovasVendas } from "./admin-novas-vendas";
import { adminCarnes } from "./admin-carnes";
import { getRequestId, installConsoleSanitizer, pseudonymizeActorId, requestLogger, withRequestId } from "./logger";

const COOKIE_NAME = "cliente_session";
const MAX_TENTATIVAS = 8;
const JANELA_SEGUNDOS = 15 * 60;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function apenasDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

function normalizarDataNascimento(valor: string) {
  const bruto = valor.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return bruto;
  const match = bruto.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function formatarCpf(cpf: string) {
  return cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : "";
}

function mesmaOrigem(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function bloquearCrossSite(request: Request) {
  return mesmaOrigem(request) ? null : json({ erro: "Requisição de origem não autorizada." }, 403);
}

async function gerarChaveRateLimit(request: Request, secret: string, contexto = "login") {
  const ip = request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${contexto}:${ip}`));
  let binary = "";
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loginCliente(request: Request, env: Env) {
  const log = requestLogger(request).child({ action: "client.auth.login", actorType: "anonymous" });
  const bad = bloquearCrossSite(request);
  if (bad) return bad;

  let body: { cpf?: string; dataNascimento?: string };
  try {
    body = await request.json();
  } catch {
    log.warn("Payload de login da cliente inválido", { eventCode: "CLIENT_LOGIN_INVALID_BODY", statusCode: 400 });
    return json({ erro: "Requisição inválida." }, 400);
  }

  const { cpf, dataNascimento } = body;
  if (!cpf || !dataNascimento) return json({ erro: "Preencha CPF e data de nascimento." }, 400);
  const cpfLimpo = apenasDigitos(cpf);
  const nascimento = normalizarDataNascimento(dataNascimento);
  if (cpfLimpo.length !== 11 || !nascimento) return json({ erro: "CPF ou data de nascimento inválidos." }, 400);
  if (!env.CLIENTE_SESSION_SECRET) {
    log.fatal("Segredo de sessão da cliente ausente", { eventCode: "CLIENT_SESSION_SECRET_MISSING", statusCode: 503 });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }

  try {
    const supabase = createServiceSupabaseClient(env);
    const key = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET);
    const { data: pode, error: rateError } = await supabase.rpc("login_pode_tentar", {
      p_chave: key,
      p_max_falhas: MAX_TENTATIVAS,
      p_janela_segundos: JANELA_SEGUNDOS,
    });
    if (rateError) {
      log.error("Falha ao consultar rate limit do login da cliente", { eventCode: "CLIENT_LOGIN_RATE_LIMIT_FAILED", statusCode: 503, error: rateError });
      return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    }
    if (!Boolean(pode)) {
      log.warn("Login da cliente bloqueado por rate limit", { eventCode: "CLIENT_LOGIN_RATE_LIMITED", statusCode: 429 });
      return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
    }

    const cpfFormatado = formatarCpf(cpfLimpo);
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("id,ativo,acesso_app_liberado")
      .in("cpf", cpfFormatado ? [cpfLimpo, cpfFormatado] : [cpfLimpo])
      .eq("data_nascimento", nascimento)
      .maybeSingle();

    if (clienteError) {
      log.error("Falha ao consultar cliente no login", { eventCode: "CLIENT_LOGIN_LOOKUP_FAILED", statusCode: 503, error: clienteError });
      return json({ erro: "Não foi possível validar seus dados agora. Tente novamente em instantes." }, 503);
    }
    if (!cliente) {
      const { error: rateWriteError } = await supabase.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      if (rateWriteError) log.warn("Credenciais inválidas e contador de rate limit não foi atualizado", { eventCode: "CLIENT_LOGIN_RATE_COUNTER_FAILED", error: rateWriteError });
      log.warn("Login da cliente recusado por credenciais inválidas", { eventCode: "CLIENT_LOGIN_DENIED", statusCode: 401 });
      return json({ erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a Sra. Luck." }, 401);
    }
    const clientLog = log.child({ actorType: "cliente", actorId: await pseudonymizeActorId(cliente.id, env) });
    if (!cliente.ativo) {
      const { error: rateWriteError } = await supabase.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      if (rateWriteError) clientLog.warn("Acesso inativo e contador de rate limit não foi atualizado", { eventCode: "CLIENT_LOGIN_RATE_COUNTER_FAILED", error: rateWriteError });
      clientLog.warn("Login recusado para cliente inativa", { eventCode: "CLIENT_LOGIN_INACTIVE", statusCode: 403 });
      return json({ erro: "Seu acesso está temporariamente indisponível. Fale com a Sra. Luck." }, 403);
    }
    if (!cliente.acesso_app_liberado) {
      clientLog.warn("Login recusado porque o acesso ao app ainda não foi liberado", { eventCode: "CLIENT_LOGIN_APP_ACCESS_NOT_RELEASED", statusCode: 403 });
      return json({ erro: "Seu acesso ao aplicativo ainda não foi liberado. Fale com a Sra. Luck." }, 403);
    }

    const { error: clearRateError } = await supabase.rpc("login_limpar_rate_limit", { p_chave: key });
    if (clearRateError) clientLog.warn("Login aceito, mas rate limit não foi limpo", { eventCode: "CLIENT_LOGIN_RATE_CLEAR_FAILED", error: clearRateError });
    const token = await criarTokenSessao(cliente.id, env.CLIENTE_SESSION_SECRET);
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
    response.headers.append("Set-Cookie", setSessionCookie(token, new URL(request.url).protocol === "https:"));
    clientLog.info("Login da cliente concluído", { eventCode: "CLIENT_LOGIN_OK" });
    return response;
  } catch (error) {
    log.error("Falha inesperada no login da cliente", { eventCode: "CLIENT_LOGIN_EXCEPTION", statusCode: 503, error });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

async function loginAdmin(request: Request, env: Env) {
  const log = requestLogger(request).child({ action: "admin.auth.login", actorType: "anonymous" });
  const bad = bloquearCrossSite(request);
  if (bad) return bad;
  if (!env.CLIENTE_SESSION_SECRET) {
    log.fatal("Segredo de sessão administrativa ausente", { eventCode: "ADMIN_SESSION_SECRET_MISSING", statusCode: 503 });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }

  let body: { email?: string; senha?: string };
  try {
    body = await request.json();
  } catch {
    log.warn("Payload de login administrativo inválido", { eventCode: "ADMIN_LOGIN_INVALID_BODY", statusCode: 400 });
    return json({ erro: "Requisição inválida." }, 400);
  }

  const email = body.email?.trim().toLowerCase();
  const senha = body.senha ?? "";
  if (!email || !senha || email.length > 320 || senha.length > 1024) return json({ erro: "E-mail ou senha incorretos." }, 401);

  const supabase = createServiceSupabaseClient(env);
  const key = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET, "admin-login");

  try {
    const { data: pode, error: rateError } = await supabase.rpc("login_pode_tentar", {
      p_chave: key,
      p_max_falhas: MAX_TENTATIVAS,
      p_janela_segundos: JANELA_SEGUNDOS,
    });
    if (rateError) {
      log.error("Falha ao consultar rate limit do login administrativo", { eventCode: "ADMIN_LOGIN_RATE_LIMIT_FAILED", statusCode: 503, error: rateError });
      return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    }
    if (!Boolean(pode)) {
      log.warn("Login administrativo bloqueado por rate limit", { eventCode: "ADMIN_LOGIN_RATE_LIMITED", statusCode: 429 });
      return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session || !data.user) {
      const { error: rateWriteError } = await supabase.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      if (rateWriteError) log.warn("Login administrativo recusado e contador de rate limit não foi atualizado", { eventCode: "ADMIN_LOGIN_RATE_COUNTER_FAILED", error: rateWriteError });
      log.warn("Login administrativo recusado", { eventCode: "ADMIN_LOGIN_DENIED", statusCode: 401 });
      return json({ erro: "E-mail ou senha incorretos." }, 401);
    }

    const adminLog = log.child({ actorType: "admin", actorId: await pseudonymizeActorId(data.user.id, env) });
    const colaborador = await buscarColaboradorAdminAtivo(data.user.id, env);
    if (!colaborador) {
      const { error: clearRateError } = await supabase.rpc("login_limpar_rate_limit", { p_chave: key });
      if (clearRateError) adminLog.warn("Acesso administrativo negado e rate limit não foi limpo", { eventCode: "ADMIN_LOGIN_RATE_CLEAR_FAILED", error: clearRateError });
      adminLog.warn("Usuário autenticado sem autorização administrativa", { eventCode: "ADMIN_LOGIN_NOT_AUTHORIZED", statusCode: 403 });
      return json({ erro: "Acesso administrativo não autorizado." }, 403, { "Cache-Control": "no-store" });
    }

    const { error: clearRateError } = await supabase.rpc("login_limpar_rate_limit", { p_chave: key });
    if (clearRateError) adminLog.warn("Login administrativo aceito, mas rate limit não foi limpo", { eventCode: "ADMIN_LOGIN_RATE_CLEAR_FAILED", error: clearRateError });
    const secure = new URL(request.url).protocol === "https:";
    const token = await criarTokenAdmin(data.user.id, env.CLIENTE_SESSION_SECRET);
    adminLog.info("Login administrativo concluído", { eventCode: "ADMIN_LOGIN_OK" });
    return json({ ok: true }, 200, {
      "Set-Cookie": setAdminSessionCookie(token, secure),
      "Cache-Control": "no-store",
    });
  } catch (error) {
    log.error("Falha inesperada no login administrativo", { eventCode: "ADMIN_LOGIN_EXCEPTION", statusCode: 503, error });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "sra-luck-api", runtime: "cloudflare-workers", supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) });
  }

  if (url.pathname === "/api/ready" && request.method === "GET") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.CLIENTE_SESSION_SECRET) return json({ ok: false, status: "not_ready" }, 503);
    try {
      const db = createServiceSupabaseClient(env);
      const inicio = Date.now();
      const { error } = await db.from("clientes").select("id", { head: true, count: "exact" });
      if (error) return json({ ok: false, status: "not_ready", checks: { database: false } }, 503);
      return json({ ok: true, status: "ready", checks: { database: true }, latencyMs: Date.now() - inicio });
    } catch {
      return json({ ok: false, status: "not_ready", checks: { database: false } }, 503);
    }
  }

  if (url.pathname === "/api/cliente/auth" && request.method === "POST") return loginCliente(request, env);
  if (url.pathname === "/api/admin/auth" && request.method === "POST") return loginAdmin(request, env);

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return json({ ok: true }, 200, { "Set-Cookie": clearAdminSessionCookie(secure), "Cache-Control": "no-store" });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const denied = await exigirAdmin(request, env);
    if (denied) return denied;
  }

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET!);
    let colaborador = null;
    if (sessao) {
      try {
        colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env);
      } catch (error) {
        requestLogger(request).error("Falha ao revalidar sessão administrativa", { action: "admin.session.revalidate", actorType: "admin", actorId: await pseudonymizeActorId(sessao.adminId, env), eventCode: "ADMIN_SESSION_REVALIDATE_FAILED", error });
        return json({ erro: "Não foi possível validar a sessão agora." }, 503);
      }
    }
    const db = createServiceSupabaseClient(env);
    const { data: perfil, error: perfilError } = colaborador
      ? await db.from("colaboradores").select("nome,cargo").eq("id", colaborador.id).maybeSingle()
      : { data: null, error: null };
    if (perfilError) requestLogger(request).warn("Sessão válida, mas perfil administrativo não foi carregado", { action: "admin.session.profile", eventCode: "ADMIN_SESSION_PROFILE_FAILED", error: perfilError });
    return json({ autenticado: true, nome: perfil?.nome ?? null, cargo: perfil?.cargo ?? colaborador?.cargo ?? null }, 200, { "Cache-Control": "no-store" });
  }

  const monitor = await monitoramentoErros(request, env);
  if (monitor) return monitor;

  if (url.pathname === "/api/cliente/session" && request.method === "GET") {
    if (!env.CLIENTE_SESSION_SECRET) return json({ autenticado: false }, 503);
    const payload = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
    if (!payload) return json({ autenticado: false }, 200, { "Cache-Control": "no-store" });
    const db = createServiceSupabaseClient(env);
    const { data: clienteSessao, error: clienteSessaoError } = await db
      .from("clientes")
      .select("ativo,acesso_app_liberado")
      .eq("id", payload.clienteId)
      .maybeSingle();
    if (clienteSessaoError) return json({ autenticado: false }, 503, { "Cache-Control": "no-store" });
    const autenticado = Boolean(clienteSessao?.ativo && clienteSessao?.acesso_app_liberado);
    return json(autenticado ? { autenticado: true, clienteId: payload.clienteId } : { autenticado: false }, 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/api/cliente/logout" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure), "Cache-Control": "no-store" });
  }

  const push = await clientPushApi(request, env);
  if (push) return push;
  const integrations = await integrationsApi(request, env);
  if (integrations) return integrations;
  const staff = await staffApi(request, env);
  if (staff) return staff;
  const creditOps = await creditOpsApi(request, env);
  if (creditOps) return creditOps;
  const journey = await journeyApi(request, env);
  if (journey) return journey;
  const clientNotificacoes = await clientNotificacoesApi(request, env);
  if (clientNotificacoes) return clientNotificacoes;
  const clientConfig = await clientConfigApi(request, env);
  if (clientConfig) return clientConfig;

  if (url.pathname === "/api/cliente/agenda" && request.method === "GET") return agenda(request, env);
  if (url.pathname === "/api/cliente/agendar" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return agendar(request, env);
  }
  if (url.pathname === "/api/cliente/agendar-cirurgia" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return agendarCirurgia(request, env);
  }
  if (url.pathname === "/api/cliente/solicitacao-liberacao-financeira" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return solicitarLiberacaoFinanceira(request, env);
  }
  if (url.pathname === "/api/cliente/remarcar-agendamento" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return remarcarAgendamento(request, env);
  }

  const agendaAdmin = await adminAgenda(request, env);
  if (agendaAdmin) return agendaAdmin;

  const clienteAgendamento = await clienteAgendamentoAcao(request, env);
  if (clienteAgendamento) return clienteAgendamento;
  const adminAgendamento = await adminAgendamentoAcao(request, env);
  if (adminAgendamento) return adminAgendamento;
  const cirurgiaAdmin = await adminSurgeryFlow(request, env);
  if (cirurgiaAdmin) return cirurgiaAdmin;

  if (url.pathname === "/api/cliente/boletos" && request.method === "GET") return handleClienteBoletos(request, env);
  const boletoMatch = url.pathname.match(/^\/api\/cliente\/boletos\/([^/]+)\/(anexar|arquivo|comprovante)$/);
  if (boletoMatch) {
    if (request.method === "POST" || request.method === "DELETE") {
      const bad = bloquearCrossSite(request);
      if (bad) return bad;
    }
    return handleClienteBoletos(request, env, decodeURIComponent(boletoMatch[1]), boletoMatch[2] as "anexar" | "arquivo" | "comprovante");
  }

  if (url.pathname === "/api/admin/visao-geral" && request.method === "GET") return adminVisaoGeral(request, env);

  const novasVendas = await adminNovasVendas(request, env);
  if (novasVendas) return novasVendas;
  const carnes = await adminCarnes(request, env);
  if (carnes) return carnes;
  const notif = await adminNotificacoes(request, env);
  if (notif) return notif;
  const finance = await adminFinance(request, env);
  if (finance) return finance;
  const reports = await adminReports(request, env);
  if (reports) return reports;
  const relatorios = await adminRelatorios(request, env);
  if (relatorios) return relatorios;
  const parcelas = await adminParcelas(request, env);
  if (parcelas) return parcelas;
  const adminResponse = await adminApi(request, env);
  if (adminResponse) return adminResponse;

  return apiJson({ ok: false, error: "ROTA_NAO_ENCONTRADA", message: "A API solicitada não existe." }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    installConsoleSanitizer();
    const requestId = getRequestId(request);
    const log = requestLogger(request, requestId);
    const inicio = Date.now();
    try {
      const response = await handleRequest(request, env);
      const durationMs = Date.now() - inicio;
      const context = { action: "http.request", statusCode: response.status, durationMs };
      if (response.status >= 500) log.error("Requisição concluída com falha de servidor", { ...context, eventCode: "HTTP_5XX" });
      else if (response.status >= 400) log.warn("Requisição concluída com erro do cliente", { ...context, eventCode: "HTTP_4XX" });
      else log.info("Requisição concluída", context);
      return withRequestId(response, requestId);
    } catch (error) {
      log.error("Exceção não tratada no Worker", { action: "http.request", eventCode: "UNHANDLED_WORKER_EXCEPTION", statusCode: 500, durationMs: Date.now() - inicio, error });
      return withRequestId(json({ erro: "Falha interna inesperada." }, 500, { "Cache-Control": "no-store" }), requestId);
    }
  },
} satisfies ExportedHandler<Env>;
