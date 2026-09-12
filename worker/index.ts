import { createServiceSupabaseClient, type Env } from "./supabase";
import { criarTokenAdmin, criarTokenSessao, getCookie, setAdminSessionCookie, setSessionCookie, clearAdminSessionCookie, clearSessionCookie, verificarTokenSessao } from "./session";
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
import { adminSurgeryFlow } from "./admin-surgery-flow";
import { monitoramentoErros } from "./monitoramento-erros";
import { creditOpsApi } from "./credit-ops";
import { journeyApi } from "./journey";
import { staffApi } from "./staff-api";
import { integrationsApi } from "./integrations-core";

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
  const bad = bloquearCrossSite(request);
  if (bad) return bad;

  let body: { cpf?: string; dataNascimento?: string };
  try {
    body = await request.json();
  } catch {
    return json({ erro: "Requisição inválida." }, 400);
  }

  const { cpf, dataNascimento } = body;
  if (!cpf || !dataNascimento) return json({ erro: "Preencha CPF e data de nascimento." }, 400);
  const cpfLimpo = apenasDigitos(cpf);
  const nascimento = normalizarDataNascimento(dataNascimento);
  if (cpfLimpo.length !== 11 || !nascimento) return json({ erro: "CPF ou data de nascimento inválidos." }, 400);
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  try {
    const supabase = createServiceSupabaseClient(env);
    const key = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET);
    const { data: pode, error: rateError } = await supabase.rpc("login_pode_tentar", {
      p_chave: key,
      p_max_falhas: MAX_TENTATIVAS,
      p_janela_segundos: JANELA_SEGUNDOS,
    });
    if (rateError) return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    if (!Boolean(pode)) return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);

    const cpfFormatado = formatarCpf(cpfLimpo);
    const { data: cliente, error: clienteError } = await supabase
      .from("clientes")
      .select("id,ativo")
      .in("cpf", cpfFormatado ? [cpfLimpo, cpfFormatado] : [cpfLimpo])
      .eq("data_nascimento", nascimento)
      .maybeSingle();

    if (clienteError) {
      console.error("Falha ao consultar cliente no login:", clienteError);
      return json({ erro: "Não foi possível validar seus dados agora. Tente novamente em instantes." }, 503);
    }
    if (!cliente) {
      await supabase.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      return json({ erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a Sra. Luck." }, 401);
    }
    if (!cliente.ativo) {
      await supabase.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      return json({ erro: "Seu acesso está temporariamente indisponível. Fale com a Sra. Luck." }, 403);
    }

    await supabase.rpc("login_limpar_rate_limit", { p_chave: key });
    const token = await criarTokenSessao(cliente.id, env.CLIENTE_SESSION_SECRET);
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
    response.headers.append("Set-Cookie", setSessionCookie(token, new URL(request.url).protocol === "https:"));
    return response;
  } catch (error) {
    console.error("Falha no login da cliente:", error);
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

async function loginAdmin(request: Request, env: Env) {
  const bad = bloquearCrossSite(request);
  if (bad) return bad;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);

  let body: { email?: string; senha?: string };
  try {
    body = await request.json();
  } catch {
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
    if (rateError) return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    if (!Boolean(pode)) return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session || !data.user) {
      await supabase.rpc("login_registrar_falha", { p_chave: key, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      return json({ erro: "E-mail ou senha incorretos." }, 401);
    }

    const colaborador = await buscarColaboradorAdminAtivo(data.user.id, env);
    if (!colaborador) {
      await supabase.rpc("login_limpar_rate_limit", { p_chave: key });
      return json({ erro: "Acesso administrativo não autorizado." }, 403, { "Cache-Control": "no-store" });
    }

    await supabase.rpc("login_limpar_rate_limit", { p_chave: key });
    const secure = new URL(request.url).protocol === "https:";
    const token = await criarTokenAdmin(data.user.id, env.CLIENTE_SESSION_SECRET);
    return json({ ok: true }, 200, {
      "Set-Cookie": setAdminSessionCookie(token, secure),
      "Cache-Control": "no-store",
    });
  } catch (error) {
    console.error("Falha no login administrativo:", error);
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const secure = url.protocol === "https:";

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "sra-luck-api",
        runtime: "cloudflare-workers",
        supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      });
    }

    if (url.pathname === "/api/cliente/auth" && request.method === "POST") return loginCliente(request, env);
    if (url.pathname === "/api/admin/auth" && request.method === "POST") return loginAdmin(request, env);

    if (url.pathname === "/api/admin/logout" && request.method === "POST") {
      const bad = bloquearCrossSite(request);
      if (bad) return bad;
      return json({ ok: true }, 200, {
        "Set-Cookie": clearAdminSessionCookie(secure),
        "Cache-Control": "no-store",
      });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      const denied = await exigirAdmin(request, env);
      if (denied) return denied;
    }

    if (url.pathname === "/api/admin/session" && request.method === "GET") {
      return json({ autenticado: true }, 200, { "Cache-Control": "no-store" });
    }

    const monitor = await monitoramentoErros(request, env);
    if (monitor) return monitor;

    if (url.pathname === "/api/cliente/session" && request.method === "GET") {
      if (!env.CLIENTE_SESSION_SECRET) return json({ autenticado: false }, 503);
      const payload = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET);
      return json(payload ? { autenticado: true, clienteId: payload.clienteId } : { autenticado: false }, 200, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/cliente/logout" && request.method === "POST") {
      const bad = bloquearCrossSite(request);
      if (bad) return bad;
      return json({ ok: true }, 200, {
        "Set-Cookie": clearSessionCookie(secure),
        "Cache-Control": "no-store",
      });
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

    const notif = await adminNotificacoes(request, env);
    if (notif) return notif;
    const finance = await adminFinance(request, env);
    if (finance) return finance;
    const reports = await adminReports(request, env);
    if (reports) return reports;
    const parcelas = await adminParcelas(request, env);
    if (parcelas) return parcelas;
    const adminResponse = await adminApi(request, env);
    if (adminResponse) return adminResponse;

    return apiJson({ ok: false, error: "ROTA_NAO_ENCONTRADA", message: "A API solicitada não existe." }, 404);
  },
} satisfies ExportedHandler<Env>;
