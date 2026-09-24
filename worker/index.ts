import { createServiceSupabaseClient, type Env } from "./supabase";
import { homeCampanhasApi } from "./home-campanhas";
import { criarTokenAdmin, criarTokenSessao, getCookie, setAdminSessionCookie, setSessionCookie, clearAdminSessionCookie, clearSessionCookie, verificarTokenAdmin, verificarTokenSessao } from "./session";
import { buscarColaboradorAdminAtivo, exigirAdmin, PERMISSOES_ADMIN } from "./admin-auth";
import { agenda, agendar, agendarCirurgia, remarcarAgendamento, solicitarLiberacaoEtapa1, solicitarLiberacaoFinanceira, json as apiJson } from "./client-agenda";
import { clienteAgendamentoAcao, adminAgendamentoAcao } from "./agendamento-acoes";
import { handleClienteBoletos } from "./client-boletos";
import { clientPushApi } from "./client-push";
import { adminVisaoGeral } from "./admin-visao-geral";
import { adminApi } from "./admin-api";
import { adminParcelas } from "./admin-parcelas";
import { adminNotificacoes } from "./admin-notificacoes";
import { agendarDespacho } from "./notificacoes-despacho";
import { adminFinance } from "./admin-finance";
import { adminReports } from "./admin-reports";
import { adminRelatorios } from "./admin-relatorios";
import { adminSurgeryFlow } from "./admin-surgery-flow";
import { adminAgendaCentral } from "./admin-agenda-central";
import { monitoramentoErros } from "./monitoramento-erros";
import { creditOpsApi } from "./credit-ops";
import { journeyApi } from "./journey";
import { clientNotificacoesApi } from "./client-notificacoes";
import { clientConfigApi } from "./client-config";
import { fraseDoDiaApi } from "./frase-do-dia";
import { staffApi } from "./staff-api";
import { integrationsApi } from "./integrations-core";
import { adminNovasVendas } from "./admin-novas-vendas";
import { adminCarnes } from "./admin-carnes";
import { adminCarneLeitor } from "./admin-carne-leitor";
import { getRequestId, installConsoleSanitizer, pseudonymizeActorId, requestLogger, withRequestId } from "./logger";
import { protectRequest } from "./http-security";
import { adminReadPermissions } from "./admin-route-permissions";

const COOKIE_NAME = "cliente_session";
const MAX_TENTATIVAS = 8;
const MAX_TENTATIVAS_CLIENTE_POR_CPF = 16;
const MAX_TENTATIVAS_ADMIN_POR_EMAIL = 12;
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

function bloquearJsonGrande(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return null;
  const length = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(length) && length > maxBytes
    ? json({ erro: "Requisição muito grande." }, 413)
    : null;
}

async function hmacRateLimit(secret: string, material: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(material));
  let binary = "";
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function gerarChaveRateLimit(request: Request, secret: string, contexto = "login") {
  const ip = request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return hmacRateLimit(secret, `${contexto}:ip:${ip}`);
}

async function gerarChaveRateLimitIdentificador(secret: string, contexto: string, identificador: string) {
  // Nunca persiste CPF/e-mail em claro na tabela de rate limit.
  return hmacRateLimit(secret, `${contexto}:identificador:${identificador}`);
}

async function exigirClienteComAcesso(request: Request, env: Env): Promise<Response | null> {
  if (!env.CLIENTE_SESSION_SECRET) {
    return json({ erro: "Serviço temporariamente indisponível." }, 503, { "Cache-Control": "no-store" });
  }

  const payload = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
  if (!payload) {
    return json({ erro: "Sessão expirada." }, 401, { "Cache-Control": "no-store" });
  }

  try {
    const db = createServiceSupabaseClient(env);
    const { data: cliente, error } = await db
      .from("clientes")
      .select("id,ativo,acesso_app_liberado")
      .eq("id", payload.clienteId)
      .maybeSingle();

    if (error) {
      requestLogger(request).error("Falha ao revalidar autorização da cliente", {
        action: "client.session.revalidate",
        actorType: "cliente",
        actorId: await pseudonymizeActorId(payload.clienteId, env),
        eventCode: "CLIENT_SESSION_REVALIDATE_FAILED",
        statusCode: 503,
        error,
      });
      return json({ erro: "Não foi possível validar o acesso agora." }, 503, { "Cache-Control": "no-store" });
    }

    if (!cliente?.ativo || !cliente?.acesso_app_liberado) {
      requestLogger(request).warn("Sessão da cliente sem autorização ativa", {
        action: "client.session.revalidate",
        actorType: "cliente",
        actorId: await pseudonymizeActorId(payload.clienteId, env),
        eventCode: "CLIENT_SESSION_ACCESS_REVOKED",
        statusCode: 403,
      });
      return json({ erro: "Seu acesso ao aplicativo não está disponível." }, 403, { "Cache-Control": "no-store" });
    }

    return null;
  } catch (error) {
    requestLogger(request).error("Exceção ao revalidar autorização da cliente", {
      action: "client.session.revalidate",
      eventCode: "CLIENT_SESSION_REVALIDATE_EXCEPTION",
      statusCode: 503,
      error,
    });
    return json({ erro: "Não foi possível validar o acesso agora." }, 503, { "Cache-Control": "no-store" });
  }
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

  const cpf = typeof body?.cpf === "string" ? body.cpf : "";
  const dataNascimento = typeof body?.dataNascimento === "string" ? body.dataNascimento : "";
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
    const keyIp = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET);
    const keyCpf = await gerarChaveRateLimitIdentificador(env.CLIENTE_SESSION_SECRET, "cliente-login", cpfLimpo);
    const [limiteIp, limiteCpf] = await Promise.all([
      supabase.rpc("rate_limit_consumir", {
        p_chave: keyIp,
        p_max_tentativas: MAX_TENTATIVAS,
        p_janela_segundos: JANELA_SEGUNDOS,
      }),
      supabase.rpc("rate_limit_consumir", {
        p_chave: keyCpf,
        p_max_tentativas: MAX_TENTATIVAS_CLIENTE_POR_CPF,
        p_janela_segundos: JANELA_SEGUNDOS,
      }),
    ]);
    if (limiteIp.error || limiteCpf.error) {
      log.error("Falha ao consultar rate limit do login da cliente", {
        eventCode: "CLIENT_LOGIN_RATE_LIMIT_FAILED",
        statusCode: 503,
        error: limiteIp.error ?? limiteCpf.error,
      });
      return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    }
    if (!Boolean(limiteIp.data) || !Boolean(limiteCpf.data)) {
      log.warn("Login da cliente bloqueado por rate limit", { eventCode: "CLIENT_LOGIN_RATE_LIMITED", statusCode: 429 });
      return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
    }

    const cpfFormatado = formatarCpf(cpfLimpo);
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("id,ativo,acesso_app_liberado")
      .in("cpf", cpfFormatado ? [cpfLimpo, cpfFormatado] : [cpfLimpo])
      .eq("data_nascimento", nascimento)
      // Um CPF pode ter um cadastro arquivado (excluído) e um novo cadastro
      // ativo (migration_077): o login usa sempre o ativo mais recente.
      .order("ativo", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clienteError) {
      log.error("Falha ao consultar cliente no login", { eventCode: "CLIENT_LOGIN_LOOKUP_FAILED", statusCode: 503, error: clienteError });
      return json({ erro: "Não foi possível validar seus dados agora. Tente novamente em instantes." }, 503);
    }
    if (!cliente) {
      log.warn("Login da cliente recusado por credenciais inválidas", { eventCode: "CLIENT_LOGIN_DENIED", statusCode: 401 });
      return json({ erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a Sra. Luck." }, 401);
    }
    const clientLog = log.child({ actorType: "cliente", actorId: await pseudonymizeActorId(cliente.id, env) });
    if (!cliente.ativo || !cliente.acesso_app_liberado) {
      clientLog.warn("Login recusado para cliente sem acesso ativo ao aplicativo", { eventCode: "CLIENT_LOGIN_ACCESS_DENIED", statusCode: 403 });
      return json({ erro: "Seu acesso ao aplicativo não está disponível. Fale com a Sra. Luck." }, 403);
    }

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

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";
  if (!email || !senha || email.length > 320 || senha.length > 1024) return json({ erro: "E-mail ou senha incorretos." }, 401);

  const supabase = createServiceSupabaseClient(env);
  const keyIp = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET, "admin-login");
  const keyEmail = await gerarChaveRateLimitIdentificador(env.CLIENTE_SESSION_SECRET, "admin-login", email);

  try {
    const [limiteIp, limiteEmail] = await Promise.all([
      supabase.rpc("rate_limit_consumir", {
        p_chave: keyIp,
        p_max_tentativas: MAX_TENTATIVAS,
        p_janela_segundos: JANELA_SEGUNDOS,
      }),
      supabase.rpc("rate_limit_consumir", {
        p_chave: keyEmail,
        p_max_tentativas: MAX_TENTATIVAS_ADMIN_POR_EMAIL,
        p_janela_segundos: JANELA_SEGUNDOS,
      }),
    ]);
    if (limiteIp.error || limiteEmail.error) {
      log.error("Falha ao consultar rate limit do login administrativo", { eventCode: "ADMIN_LOGIN_RATE_LIMIT_FAILED", statusCode: 503, error: limiteIp.error ?? limiteEmail.error });
      return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    }
    if (!Boolean(limiteIp.data) || !Boolean(limiteEmail.data)) {
      log.warn("Login administrativo bloqueado por rate limit", { eventCode: "ADMIN_LOGIN_RATE_LIMITED", statusCode: 429 });
      return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session || !data.user) {
      log.warn("Login administrativo recusado", { eventCode: "ADMIN_LOGIN_DENIED", statusCode: 401 });
      return json({ erro: "E-mail ou senha incorretos." }, 401);
    }

    const adminLog = log.child({ actorType: "admin", actorId: await pseudonymizeActorId(data.user.id, env) });
    const colaborador = await buscarColaboradorAdminAtivo(data.user.id, env);
    if (!colaborador) {
      adminLog.warn("Usuário autenticado sem autorização administrativa", { eventCode: "ADMIN_LOGIN_NOT_AUTHORIZED", statusCode: 403 });
      return json({ erro: "Acesso administrativo não autorizado." }, 403, { "Cache-Control": "no-store" });
    }
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

  if (url.pathname === "/api/cliente/auth" && request.method === "POST") {
    const grande = bloquearJsonGrande(request, 16_384);
    if (grande) return grande;
    return loginCliente(request, env);
  }
  if (url.pathname === "/api/admin/auth" && request.method === "POST") {
    const grande = bloquearJsonGrande(request, 16_384);
    if (grande) return grande;
    return loginAdmin(request, env);
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return json({ ok: true }, 200, { "Set-Cookie": clearAdminSessionCookie(secure), "Cache-Control": "no-store" });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const bad = bloquearCrossSite(request);
      if (bad) return bad;
      const grande = bloquearJsonGrande(request, 262_144);
      if (grande) return grande;
    }
    const denied = await exigirAdmin(request, env, ["GET", "HEAD"].includes(request.method) ? adminReadPermissions(url.pathname) : null);
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
    return json({
      autenticado: true,
      nome: perfil?.nome ?? null,
      cargo: perfil?.cargo ?? colaborador?.cargo ?? null,
      permissoes: colaborador?.cargo === "administrativo" ? Object.values(PERMISSOES_ADMIN) : colaborador?.permissoes ?? [],
      acessoTotal: colaborador?.cargo === "administrativo",
    }, 200, { "Cache-Control": "no-store" });
  }

  const monitor = await monitoramentoErros(request, env);
  if (monitor) return monitor;

  if (url.pathname === "/api/cliente/session" && request.method === "GET") {
    if (!env.CLIENTE_SESSION_SECRET) return json({ autenticado: false }, 503, { "Cache-Control": "no-store" });
    const payload = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
    if (!payload) return json({ autenticado: false }, 200, { "Cache-Control": "no-store" });

    const bloqueio = await exigirClienteComAcesso(request, env);
    if (bloqueio) {
      return json({ autenticado: false }, bloqueio.status, {
        "Cache-Control": "no-store",
        ...(bloqueio.status === 401 || bloqueio.status === 403 ? { "Set-Cookie": clearSessionCookie(secure) } : {}),
      });
    }
    return json({ autenticado: true, clienteId: payload.clienteId }, 200, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/api/cliente/logout" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure), "Cache-Control": "no-store" });
  }

  if (url.pathname.startsWith("/api/cliente/") && url.pathname !== "/api/cliente/config-publica") {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const bad = bloquearCrossSite(request);
      if (bad) return bad;
      const grande = bloquearJsonGrande(request, 262_144);
      if (grande) return grande;
    }
    const bloqueio = await exigirClienteComAcesso(request, env);
    if (bloqueio) return bloqueio;
  }

  const homeCampanhas = await homeCampanhasApi(request, env);
  if (homeCampanhas) return homeCampanhas;
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
  const fraseDia = await fraseDoDiaApi(request, env);
  if (fraseDia) return fraseDia;
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
  if (url.pathname === "/api/cliente/agenda/solicitar-liberacao" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return solicitarLiberacaoEtapa1(request, env);
  }
  if (url.pathname === "/api/cliente/remarcar-agendamento" && request.method === "POST") {
    const bad = bloquearCrossSite(request);
    if (bad) return bad;
    return remarcarAgendamento(request, env);
  }

  const clienteAgendamento = await clienteAgendamentoAcao(request, env);
  if (clienteAgendamento) return clienteAgendamento;
  const adminAgendamento = await adminAgendamentoAcao(request, env);
  if (adminAgendamento) return adminAgendamento;
  const cirurgiaAdmin = await adminSurgeryFlow(request, env);
  if (cirurgiaAdmin) return cirurgiaAdmin;
  const centralAdmin = await adminAgendaCentral(request, env);
  if (centralAdmin) return centralAdmin;

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
  const leitorCarne = await adminCarneLeitor(request, env);
  if (leitorCarne) return leitorCarne;
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

function deveDespacharPush(request: Request) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/admin/") && !pathname.startsWith("/api/cliente/")) return false;
  return request.method !== "GET" || pathname === "/api/cliente/notificacoes";
}

export default {
  async fetch(request: Request, env: Env, ctx?: { waitUntil?: (p: Promise<unknown>) => void }) {
    installConsoleSanitizer();
    const requestId = getRequestId(request);
    const log = requestLogger(request, requestId);
    const inicio = Date.now();
    try {
      const protectedRequest = await protectRequest(request);
      const response = protectedRequest instanceof Response ? protectedRequest : await handleRequest(protectedRequest, env);
      // Avisos gravados pelo banco (agenda, pagamentos, clube) saem como Web Push
      // na próxima ação do painel ou do app, em segundo plano.
      if (response.status < 400 && deveDespacharPush(request)) agendarDespacho(env, ctx);
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
