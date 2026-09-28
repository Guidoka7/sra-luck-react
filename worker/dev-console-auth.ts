import { criarTokenAdmin } from "./session";
import type { Env } from "./supabase";

export const DEV_CONSOLE_ADMIN_PREFIX = "dev-console:";
export const DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID = "00000000-0000-4000-8000-000000000046";

const TOKEN_HEADER = "x-dev-console-token";
const ACTOR_HEADER = "x-dev-actor-id";
const ROLE_HEADER = "x-dev-actor-role";
function json(erro: string, codigo: string, status: number) {
  return new Response(JSON.stringify({ erro, codigo }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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

/** Papéis do Dev Console que podem ESCREVER via M2M. viewer e ausente = leitura. */
export const DEV_CONSOLE_WRITE_ROLES = new Set(["owner", "developer", "operator"]);

/**
 * Autenticação do Dev (Dev Console, server-to-server).
 *
 * Leitura (GET/HEAD) em /api/admin/* para qualquer papel do Dev Console.
 * Escrita somente para papéis com escrita (owner, developer, operator),
 * informado pelo Console em x-dev-actor-role depois de aplicar o próprio RBAC
 * por domínio. viewer — ou papel ausente/desconhecido — é somente leitura
 * (decisão do responsável em 28/09/2026, substitui a de 24/09).
 * A segurança continua sendo o token técnico (DEV_CONSOLE_SERVICE_TOKEN,
 * comparação em tempo constante) e a sessão efêmera assinada "dev-console:<ator>",
 * que o Worker trata como administrativo e registra na auditoria.
 *
 * - Sem header técnico: fluxo normal do Admin, intacto.
 * - Fora de /api/admin/*: remove os headers técnicos e segue normalmente.
 * - Token inválido ou não configurado: recusa antes de qualquer operação.
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

  const supplied = presented.trim();
  if (!supplied || !(await safeEqual(supplied, expected))) {
    return json("Credencial técnica inválida.", "DEV_CONSOLE_TOKEN_INVALID", 401);
  }

  const role = String(request.headers.get(ROLE_HEADER) || "").trim().toLowerCase();
  if (!["GET", "HEAD"].includes(request.method) && !DEV_CONSOLE_WRITE_ROLES.has(role)) {
    return json("Seu papel no Dev Console não permite esta alteração.", "DEV_CONSOLE_ROLE_INSUFFICIENT", 403);
  }

  const actor = normalizeActor(request.headers.get(ACTOR_HEADER));
  const session = await criarTokenAdmin(`${DEV_CONSOLE_ADMIN_PREFIX}${actor}`, env.CLIENTE_SESSION_SECRET);
  return withAdminCookie(request, session);
}
