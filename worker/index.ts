import { createServiceSupabaseClient, type Env } from "./supabase";
import { criarTokenSessao, getCookie, setSessionCookie, clearSessionCookie, verificarTokenSessao } from "./session";
import { agenda, agendar, agendarCirurgia, json as apiJson } from "./client-agenda";
import { handleClienteBoletos } from "./client-boletos";
import { adminVisaoGeral } from "./admin-visao-geral";

const COOKIE_NAME = "cliente_session";
const MAX_TENTATIVAS = 8;
const JANELA_SEGUNDOS = 15 * 60;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}
function apenasDigitos(valor: string): string { return valor.replace(/\D/g, ""); }
function mesmaOrigem(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}
function bloquearCrossSite(request: Request): Response | null {
  return mesmaOrigem(request) ? null : json({ erro: "Requisição de origem não autorizada." }, 403);
}
async function gerarChaveRateLimit(request: Request, secret: string, contexto = "login"): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP")?.trim() || request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${contexto}:${ip}`));
  let binary = ""; for (const byte of new Uint8Array(assinatura)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function loginCliente(request: Request, env: Env): Promise<Response> {
  const origemInvalida = bloquearCrossSite(request); if (origemInvalida) return origemInvalida;
  let body: { cpf?: string; dataNascimento?: string };
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const { cpf, dataNascimento } = body;
  if (!cpf || !dataNascimento) return json({ erro: "Preencha CPF e data de nascimento." }, 400);
  const cpfLimpo = apenasDigitos(cpf);
  if (cpfLimpo.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) return json({ erro: "CPF ou data de nascimento inválidos." }, 401);
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  try {
    const supabase = createServiceSupabaseClient(env);
    const rateLimitKey = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET);
    const { data: podeTentar, error: rateLimitError } = await supabase.rpc("login_pode_tentar", { p_chave: rateLimitKey, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
    if (rateLimitError) return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    if (!Boolean(podeTentar)) return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);
    const { data: cliente, error } = await supabase.from("clientes").select("id, ativo").eq("cpf", cpfLimpo).eq("data_nascimento", dataNascimento).maybeSingle();
    if (error || !cliente) { await supabase.rpc("login_registrar_falha", { p_chave: rateLimitKey, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS }); return json({ erro: "CPF ou data de nascimento não encontrados. Confira os dados ou fale com a clínica." }, 401); }
    if (!cliente.ativo) { await supabase.rpc("login_registrar_falha", { p_chave: rateLimitKey, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS }); return json({ erro: "Seu acesso está temporariamente indisponível. Fale com a clínica." }, 403); }
    await supabase.rpc("login_limpar_rate_limit", { p_chave: rateLimitKey });
    const token = await criarTokenSessao(cliente.id, env.CLIENTE_SESSION_SECRET);
    const headers = new Headers({ "Cache-Control": "no-store" }); headers.append("Set-Cookie", setSessionCookie(token, new URL(request.url).protocol === "https:"));
    return json({ ok: true }, 200, headers);
  } catch (error) { console.error("Falha no login da cliente:", error); return json({ erro: "Serviço temporariamente indisponível." }, 503); }
}

async function loginAdmin(request: Request, env: Env): Promise<Response> {
  const origemInvalida = bloquearCrossSite(request); if (origemInvalida) return origemInvalida;
  if (!env.CLIENTE_SESSION_SECRET) return json({ erro: "Serviço temporariamente indisponível." }, 503);
  let body: { email?: string; senha?: string };
  try { body = await request.json(); } catch { return json({ erro: "Requisição inválida." }, 400); }
  const email = body.email?.trim().toLowerCase();
  const senha = body.senha ?? "";
  if (!email || !senha || email.length > 320 || senha.length > 1024) return json({ erro: "E-mail ou senha incorretos." }, 401);
  const supabase = createServiceSupabaseClient(env);
  const rateLimitKey = await gerarChaveRateLimit(request, env.CLIENTE_SESSION_SECRET, "admin-login");
  try {
    const { data: podeTentar, error: rateLimitError } = await supabase.rpc("login_pode_tentar", { p_chave: rateLimitKey, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
    if (rateLimitError) return json({ erro: "Não foi possível validar o acesso agora. Tente novamente em instantes." }, 503);
    if (!Boolean(podeTentar)) return json({ erro: "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente." }, 429);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error || !data.session || !data.user) {
      await supabase.rpc("login_registrar_falha", { p_chave: rateLimitKey, p_max_falhas: MAX_TENTATIVAS, p_janela_segundos: JANELA_SEGUNDOS });
      return json({ erro: "E-mail ou senha incorretos." }, 401);
    }

    await supabase.rpc("login_limpar_rate_limit", { p_chave: rateLimitKey });
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at ?? null }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    console.error("Falha no login administrativo:", error);
    return json({ erro: "Serviço temporariamente indisponível." }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const secure = url.protocol === "https:";
    if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "sra-luck-api", runtime: "cloudflare-workers", supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) });
    if (url.pathname === "/api/cliente/auth" && request.method === "POST") return loginCliente(request, env);
    if (url.pathname === "/api/admin/auth" && request.method === "POST") return loginAdmin(request, env);
    if (url.pathname === "/api/cliente/session" && request.method === "GET") { if (!env.CLIENTE_SESSION_SECRET) return json({ autenticado: false }, 503); const payload = await verificarTokenSessao(getCookie(request, COOKIE_NAME), env.CLIENTE_SESSION_SECRET); return json(payload ? { autenticado: true, clienteId: payload.clienteId } : { autenticado: false }, 200, { "Cache-Control": "no-store" }); }
    if (url.pathname === "/api/cliente/logout" && request.method === "POST") { const origemInvalida = bloquearCrossSite(request); if (origemInvalida) return origemInvalida; return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure), "Cache-Control": "no-store" }); }
    if (url.pathname === "/api/cliente/agenda" && request.method === "GET") return agenda(request, env);
    if (url.pathname === "/api/cliente/agendar" && request.method === "POST") { const origemInvalida = bloquearCrossSite(request); if (origemInvalida) return origemInvalida; return agendar(request, env); }
    if (url.pathname === "/api/cliente/agendar-cirurgia" && request.method === "POST") { const origemInvalida = bloquearCrossSite(request); if (origemInvalida) return origemInvalida; return agendarCirurgia(request, env); }
    if (url.pathname === "/api/cliente/boletos" && request.method === "GET") return handleClienteBoletos(request, env);
    const boletoMatch = url.pathname.match(/^\/api\/cliente\/boletos\/([^/]+)\/(anexar|arquivo|comprovante)$/);
    if (boletoMatch) { if (request.method === "POST" || request.method === "DELETE") { const origemInvalida = bloquearCrossSite(request); if (origemInvalida) return origemInvalida; } return handleClienteBoletos(request, env, decodeURIComponent(boletoMatch[1]), boletoMatch[2] as "anexar" | "arquivo" | "comprovante"); }
    if (url.pathname === "/api/admin/visao-geral" && request.method === "GET") return adminVisaoGeral(request, env);
    return apiJson({ ok: false, error: "ROTA_NAO_ENCONTRADA", message: "A API solicitada não existe." }, 404);
  },
} satisfies ExportedHandler<Env>;
