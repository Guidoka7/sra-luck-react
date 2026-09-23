import { criarTokenAdmin } from "./session";
import type { Env } from "./supabase";

export const DEV_CONSOLE_ADMIN_PREFIX = "dev-console:";
export const DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID = "00000000-0000-4000-8000-000000000046";

const TOKEN_HEADER = "x-dev-console-token";
const ACTOR_HEADER = "x-dev-actor-id";
const ROLE_HEADER = "x-dev-actor-role";

const ALLOWED_EXACT = new Set([
  "/api/admin/session",
  "/api/admin/visao-geral",
  "/api/admin/previsao-liberacoes",
]);

const ALLOWED_PREFIXES = [
  "/api/admin/central/",
  "/api/admin/financeiro/",
  "/api/admin/credit-ops/finance/",
  "/api/admin/credit-ops/club",
  "/api/admin/credit-ops/rewards",
  "/api/admin/monitoramento",
  "/api/admin/diagnostico",
  "/api/admin/notificacoes/",
  "/api/admin/integrations/",
  "/api/admin/staff",
  "/api/admin/configuracoes",
  "/api/admin/clientes",
];

function json(erro: string, codigo: string, status: number) {
  return new Response(JSON.stringify({ erro, codigo }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function allowedPath(pathname: string) {
  return ALLOWED_EXACT.has(pathname) || ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function normalizeActor(value: string | null) {
  const actor = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(actor) ? actor : "service";
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function safeEqual(a: string, b: string) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function withAdminCookie(request: Request, token: string) {
  const headers = new Headers(request.headers);
  const existing = String(headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("admin_session="));
  existing.push(`admin_session=${token}`);
  headers.set("cookie", existing.join("; "));
  headers.delete(TOKEN_HEADER);
  headers.delete(ACTOR_HEADER);
  headers.delete(ROLE_HEADER);
  return new Request(request, { headers });
}

function stripTechnicalHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete(TOKEN_HEADER);
  headers.delete(ACTOR_HEADER);
  headers.delete(ROLE_HEADER);
  return new Request(request, { headers });
}

export function isDevConsoleSyntheticAdminId(value: string) {
  return value.startsWith(DEV_CONSOLE_ADMIN_PREFIX)
    && value.length > DEV_CONSOLE_ADMIN_PREFIX.length
    && value.length <= DEV_CONSOLE_ADMIN_PREFIX.length + 128;
}

/**
 * Autenticação server-to-server do Dev Console.
 *
 * - Sem header técnico: mantém o fluxo normal do Admin intacto.
 * - Em rotas não administrativas: remove headers técnicos e segue normalmente.
 * - Em /api/admin/*: aceita somente GET/HEAD de uma allowlist explícita.
 * - Após validar o segredo, converte a identidade técnica em uma sessão admin
 *   assinada e efêmera, consumida pelos guardrails já existentes do Worker.
 */
export async function authorizeDevConsoleRequest(request: Request, env: Env): Promise<Request | Response> {
  const presented = request.headers.get(TOKEN_HEADER);
  if (!presented) return request;

  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/admin/")) return stripTechnicalHeaders(request);

  const expected = String(env.DEV_CONSOLE_SERVICE_TOKEN || "").trim();
  if (expected.length < 32 || !env.CLIENTE_SESSION_SECRET) {
    return json("Integração técnica indisponível.", "DEV_CONSOLE_M2M_NOT_CONFIGURED", 503);
  }

  if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
    return json("A integração técnica está restrita a consultas.", "DEV_CONSOLE_M2M_READ_ONLY", 403);
  }

  if (!allowedPath(pathname)) {
    return json("Rota não autorizada para a integração técnica.", "DEV_CONSOLE_ROUTE_NOT_ALLOWED", 403);
  }

  const supplied = presented.trim();
  if (!supplied || !(await safeEqual(supplied, expected))) {
    return json("Credencial técnica inválida.", "DEV_CONSOLE_TOKEN_INVALID", 401);
  }

  const actor = normalizeActor(request.headers.get(ACTOR_HEADER));
  const session = await criarTokenAdmin(`${DEV_CONSOLE_ADMIN_PREFIX}${actor}`, env.CLIENTE_SESSION_SECRET);
  return withAdminCookie(request, session);
}
