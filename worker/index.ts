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
import { monitoramentoErros } from "./monitoramento-erros";
import { creditOpsApi } from "./credit-ops";
import { clientNotificacoesApi } from "./client-notificacoes";
import { clientConfigApi } from "./client-config";
import { staffApi } from "./staff-api";
import { integrationsApi } from "./integrations-core";
import { adminNovasVendas } from "./admin-novas-vendas";
import { adminCarnes } from "./admin-carnes";
import { getRequestId, installConsoleSanitizer, pseudonymizeActorId, requestLogger, withRequestId } from "./logger";
import { applyApiSecurityHeaders, enforceActionRateLimit, enforceClientAccountState, enforceMutationOrigin, enforceRequestSize, hmacFingerprint, verifyTurnstile } from "./security";

const COOKIE_NAME = "cliente_session";
const MAX_TENTATIVAS = 8;
const JANELA_SEGUNDOS = 15 * 60;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function apenasDigitos(valor: string) { return valor.replace(/\D/g, ""); }

function normalizarDataNascimento(valor: string) {
  const bruto = valor.trim();
  let iso = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) iso = bruto;
  else {
    const match = bruto.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (match) iso = `${match[3]}-${match[2]}-${match[1]}`;
  }
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return "";
  if (data.getTime() > Date.now()) return "";
  return iso;
}

function formatarCpf(cpf: string) {
  return cpf.length === 11 ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : "";
}

async function gerarChaveRateLimit(request: Request, secret: string, contexto = "login") {
  const ip = request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return `${contexto}:ip:${await hmacFingerprint(ip, secret)}`;
}

async function rateLimitPermitido(db: ReturnType<typeof createServiceSupabaseClient>, keys: string[]) {
  for (const key of keys) {
    const { data, error } = await db.rpc("login_pode_tentar", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
    if (error) return { ok: false as const, error };
    if (!Boolean(data)) return { ok: true as const, permitido: false as const };
  }
  return { ok: true as const, permitido: true as const };
}

async function registrarFalha(db: ReturnType<typeof createServiceSupabaseClient>, keys: string[]) {
  for (const key of keys) await db.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
}
async function limparRateLimit(db: ReturnType<typeof createServiceSupabaseClient>, keys: string[]) {
  for (const key of keys) await db.rpc("login_limpar_rate_limit", { p_chave: key });
}

async function loginCliente(request: Request, env: Env) {
  const log = requestLogger(request).child({ action: "client.auth.login", actorType: "anonymous" });
  let body: { cpf?: string; dataNascimento?: string; turnstileToken?: string };
  try { body = await request.json(); }
  catch {
    log.warn("Payload de login da cliente inválido", { eventCode: "CLIENT_LOGIN_INVALID_BODY", statusCode: 400 });
    return json({ erro: "Não foi possível entrar com esses dados." }, 400);
  }

  const cpfLimpo = apenasDigitos(body.cpf || "");
  const nascimento = normalizarDataNascimento(body.dataNascimento || "");
  if (cpfLimpo.length !== 11 || !nascimento) return json({ erro: "Não foi possível entrar com esses dados." }, 401);
  if (!env.CLIENTE_SESSION_SECRET) {
    log.fatal("Segredo de sessão da cliente ausente", { eventCode: "CLIENT_SESSION_SECRET_MISSING", statusCode: 503 });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }

  const bot = await verifyTurnstile(request, env, body.turnstileToken);
  if (!bot.ok) return json({ erro: bot.erro }, bot.status);

  try {
    const supabase = createServiceSupabaseClient(env);
    const keys = [
      await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET, "cliente-login"),
      `cliente-login:id:${await hmacFingerprint(cpfLimpo, env.CLIENTE_SESSION_SECRET)}`,
    ];
    const rate = await rateLimitPermitido(supabase, keys);
    if (!rate.ok) {
      log.error("Falha ao consultar rate limit do login da cliente", { eventCode: "CLIENT_LOGIN_RATE_LIMIT_FAILED", statusCode: 503, error: rate.error });
      return json({ erro: "Não foi possível validar o acesso agora." }, 503);
    }
    if (!rate.permitido) {
      log.warn("Login da cliente bloqueado por rate limit", { eventCode: "CLIENT_LOGIN_RATE_LIMITED", statusCode: 429 });
      return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
    }

    const cpfFormatado = formatarCpf(cpfLimpo);
    const { data: cliente, error } = await supabase.from("clientes")
      .select("id,ativo,status_contrato")
      .in("cpf", cpfFormatado ? [cpfLimpo, cpfFormatado] : [cpfLimpo])
      .eq("data_nascimento", nascimento)
      .maybeSingle();
    if (error) {
      log.error("Falha ao consultar cliente no login", { eventCode: "CLIENT_LOGIN_LOOKUP_FAILED", statusCode: 503, error });
      return json({ erro: "Não foi possível validar o acesso agora." }, 503);
    }

    const status = String(cliente?.status_contrato || "ativo").toLowerCase();
    if (!cliente || cliente.ativo !== true || status === "cancelado") {
      await registrarFalha(supabase, keys);
      log.warn("Login da cliente recusado", { eventCode: "CLIENT_LOGIN_DENIED", statusCode: 401 });
      return json({ erro: "Não foi possível entrar com esses dados." }, 401);
    }

    const clientLog = log.child({ actorType: "cliente", actorId: await pseudonymizeActorId(cliente.id, env) });
    await limparRateLimit(supabase, keys);
    const token = await criarTokenSessao(cliente.id, env.CLIENTE_SESSION_SECRET);
    clientLog.info("Login da cliente concluído", { eventCode: "CLIENT_LOGIN_OK" });
    return json({ ok: true }, 200, { "Set-Cookie": setSessionCookie(token, new URL(request.url).protocol === "https:") });
  } catch (error) {
    log.error("Falha inesperada no login da cliente", { eventCode: "CLIENT_LOGIN_EXCEPTION", statusCode: 503, error });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

async function loginAdmin(request: Request, env: Env) {
  const log = requestLogger(request).child({ action: "admin.auth.login", actorType: "anonymous" });
  if (!env.CLIENTE_SESSION_SECRET) {
    log.fatal("Segredo de sessão administrativa ausente", { eventCode: "ADMIN_SESSION_SECRET_MISSING", statusCode: 503 });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
  let body: { email?: string; senha?: string; turnstileToken?: string };
  try { body = await request.json(); }
  catch { return json({ erro: "E-mail ou senha incorretos." }, 401); }

  const email = body.email?.trim().toLowerCase() || "";
  const senha = body.senha ?? "";
  if (!email || !senha || email.length > 320 || senha.length > 1024) return json({ erro: "E-mail ou senha incorretos." }, 401);
  const bot = await verifyTurnstile(request, env, body.turnstileToken);
  if (!bot.ok) return json({ erro: bot.erro }, bot.status);

  const supabase = createServiceSupabaseClient(env);
  const keys = [
    await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET, "admin-login"),
    `admin-login:id:${await hmacFingerprint(email, env.CLIENTE_SESSION_SECRET)}`,
  ];
  try {
    const rate = await rateLimitPermitido(supabase, keys);
    if (!rate.ok) return json({ erro: "Não foi possível validar o acesso agora." }, 503);
    if (!rate.permitido) return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session || !data.user) {
      await registrarFalha(supabase, keys);
      log.warn("Login administrativo recusado", { eventCode: "ADMIN_LOGIN_DENIED", statusCode: 401 });
      return json({ erro: "E-mail ou senha incorretos." }, 401);
    }

    const adminLog = log.child({ actorType: "admin", actorId: await pseudonymizeActorId(data.user.id, env) });
    const colaborador = await buscarColaboradorAdminAtivo(data.user.id, env);
    if (!colaborador) {
      await registrarFalha(supabase, keys);
      adminLog.warn("Usuário autenticado sem autorização administrativa", { eventCode: "ADMIN_LOGIN_NOT_AUTHORIZED", statusCode: 403 });
      return json({ erro: "E-mail ou senha incorretos." }, 401);
    }

    await limparRateLimit(supabase, keys);
    const token = await criarTokenAdmin(data.user.id, env.CLIENTE_SESSION_SECRET);
    adminLog.info("Login administrativo concluído", { eventCode: "ADMIN_LOGIN_OK" });
    return json({ ok: true }, 200, { "Set-Cookie": setAdminSessionCookie(token, new URL(request.url).protocol === "https:") });
  } catch (error) {
    log.error("Falha inesperada no login administrativo", { eventCode: "ADMIN_LOGIN_EXCEPTION", statusCode: 503, error });
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  const tooLarge = enforceRequestSize(request);
  if (tooLarge) return tooLarge;
  const csrf = enforceMutationOrigin(request, env);
  if (csrf) return csrf;

  if (url.pathname === "/api/health" && request.method === "GET") return json({ status: "ok" });
  if (url.pathname === "/api/ready" && request.method === "GET") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.CLIENTE_SESSION_SECRET) return json({ status: "not_ready" }, 503);
    try {
      const db = createServiceSupabaseClient(env);
      const inicio = Date.now();
      const { error } = await db.from("clientes").select("id", { head: true, count: "exact" });
      if (error) return json({ status: "not_ready" }, 503);
      return json({ status: "ready", latencyMs: Date.now() - inicio });
    } catch { return json({ status: "not_ready" }, 503); }
  }

  if (url.pathname === "/api/cliente/auth" && request.method === "POST") return loginCliente(request, env);
  if (url.pathname === "/api/admin/auth" && request.method === "POST") return loginAdmin(request, env);

  if (url.pathname === "/api/admin/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearAdminSessionCookie(secure) });

  if (url.pathname.startsWith("/api/admin/")) {
    const denied = await exigirAdmin(request, env);
    if (denied) return denied;
  }

  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    const sessao = await verificarTokenAdmin(getCookie(request, "admin_session"), env.CLIENTE_SESSION_SECRET!);
    let colaborador = null;
    if (sessao) {
      try { colaborador = await buscarColaboradorAdminAtivo(sessao.adminId, env); }
      catch (error) {
        requestLogger(request).error("Falha ao revalidar sessão administrativa", { action: "admin.session.revalidate", actorType: "admin", actorId: await pseudonymizeActorId(sessao.adminId, env), eventCode: "ADMIN_SESSION_REVALIDATE_FAILED", error });
        return json({ erro: "Não foi possível validar a sessão agora." }, 503);
      }
    }
    if (!colaborador) return json({ autenticado: false }, 200);
    const db = createServiceSupabaseClient(env);
    const { data: perfil } = await db.from("colaboradores").select("nome,cargo").eq("id", colaborador.id).maybeSingle();
    return json({ autenticado: true, nome: perfil?.nome ?? null, cargo: perfil?.cargo ?? colaborador.cargo ?? null });
  }

  const clientState = await enforceClientAccountState(request, env);
  if (clientState) return clientState;

  const actionLimit = await enforceActionRateLimit(request, env);
  if (actionLimit) return actionLimit;

  const monitor = await monitoramentoErros(request, env);
  if (monitor) return monitor;

  if (url.pathname === "/api/cliente/session" && request.method === "GET") {
    if (!env.CLIENTE_SESSION_SECRET) return json({ autenticado: false }, 503);
    const payload = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
    return json({ autenticado: Boolean(payload) });
  }
  if (url.pathname === "/api/cliente/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure) });

  const push = await clientPushApi(request, env); if (push) return push;
  const integrations = await integrationsApi(request, env); if (integrations) return integrations;
  const staff = await staffApi(request, env); if (staff) return staff;
  const creditOps = await creditOpsApi(request, env); if (creditOps) return creditOps;

  // Subsistema antigo removido do runtime: dependia de contratos_credito/agenda_janelas inexistentes
  // e duplicava o fluxo canônico de clientes + boletos + agendamentos.
  if (url.pathname.startsWith("/api/admin/journey/") || url.pathname === "/api/cliente/journey" || url.pathname.startsWith("/api/cliente/journey/")) {
    return json({ erro: "Fluxo legado desativado. Use a jornada atual." }, 410);
  }

  const clientNotificacoes = await clientNotificacoesApi(request, env); if (clientNotificacoes) return clientNotificacoes;
  const clientConfig = await clientConfigApi(request, env); if (clientConfig) return clientConfig;

  if (url.pathname === "/api/cliente/agenda" && request.method === "GET") return agenda(request, env);
  if (url.pathname === "/api/cliente/agendar" && request.method === "POST") return agendar(request, env);
  if (url.pathname === "/api/cliente/agendar-cirurgia" && request.method === "POST") return agendarCirurgia(request, env);
  if (url.pathname === "/api/cliente/solicitacao-liberacao-financeira" && request.method === "POST") return solicitarLiberacaoFinanceira(request, env);
  if (url.pathname === "/api/cliente/remarcar-agendamento" && request.method === "POST") return remarcarAgendamento(request, env);

  const clienteAgendamento = await clienteAgendamentoAcao(request, env); if (clienteAgendamento) return clienteAgendamento;
  const adminAgendamento = await adminAgendamentoAcao(request, env); if (adminAgendamento) return adminAgendamento;
  const cirurgiaAdmin = await adminSurgeryFlow(request, env); if (cirurgiaAdmin) return cirurgiaAdmin;

  if (url.pathname === "/api/cliente/boletos" && request.method === "GET") return handleClienteBoletos(request, env);
  const boletoMatch = url.pathname.match(/^\/api\/cliente\/boletos\/([^/]+)\/(anexar|arquivo|comprovante)$/);
  if (boletoMatch) return handleClienteBoletos(request, env, decodeURIComponent(boletoMatch[1]), boletoMatch[2] as "anexar" | "arquivo" | "comprovante");

  if (url.pathname === "/api/admin/visao-geral" && request.method === "GET") return adminVisaoGeral(request, env);
  const novasVendas = await adminNovasVendas(request, env); if (novasVendas) return novasVendas;
  const carnes = await adminCarnes(request, env); if (carnes) return carnes;
  const notif = await adminNotificacoes(request, env); if (notif) return notif;
  const finance = await adminFinance(request, env); if (finance) return finance;
  const reports = await adminReports(request, env); if (reports) return reports;
  const relatorios = await adminRelatorios(request, env); if (relatorios) return relatorios;
  const parcelas = await adminParcelas(request, env); if (parcelas) return parcelas;
  const adminResponse = await adminApi(request, env); if (adminResponse) return adminResponse;

  return apiJson({ ok: false, error: "ROTA_NAO_ENCONTRADA", message: "A API solicitada não existe." }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    installConsoleSanitizer();
    const requestId = getRequestId(request);
    const log = requestLogger(request, requestId);
    const inicio = Date.now();
    try {
      const rawResponse = await handleRequest(request, env);
      const response = applyApiSecurityHeaders(withRequestId(rawResponse, requestId), request);
      const durationMs = Date.now() - inicio;
      const context = { action: "http.request", statusCode: response.status, durationMs };
      if (response.status >= 500) log.error("Requisição concluída com falha de servidor", { ...context, eventCode: "HTTP_5XX" });
      else if (response.status >= 400) log.warn("Requisição concluída com erro do cliente", { ...context, eventCode: "HTTP_4XX" });
      else log.info("Requisição concluída", context);
      return response;
    } catch (error) {
      log.error("Exceção não tratada no Worker", { action: "http.request", eventCode: "UNHANDLED_WORKER_EXCEPTION", statusCode: 500, durationMs: Date.now() - inicio, error });
      return applyApiSecurityHeaders(withRequestId(json({ erro: "Falha interna inesperada." }, 500), requestId), request);
    }
  },
} satisfies ExportedHandler<Env>;
