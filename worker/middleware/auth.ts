import type { Env } from "../supabase.js";
import {
  getCookie,
  verificarTokenAdmin,
  verificarTokenSessao,
  verificarTokenStaff,
} from "../session.js";

export type ActorType = "admin" | "cliente" | "equipe" | "sistema";

export interface Actor {
  type: ActorType;
  id: string;
  role?: string;
}

export interface AuthSuccess {
  ok: true;
  actor: Actor;
}

export interface AuthFailure {
  ok: false;
  response: Response;
}

export type AuthResult = AuthSuccess | AuthFailure;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

export function requireSameOrigin(request: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  return sameOrigin(request) ? null : json({ erro: "Requisição de origem não autorizada." }, 403);
}

function secret(env: Env): string | null {
  return env.CLIENTE_SESSION_SECRET?.trim() || null;
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthResult> {
  const key = secret(env);
  if (!key) return { ok: false, response: json({ erro: "Serviço de autenticação indisponível." }, 503) };
  const session = await verificarTokenAdmin(getCookie(request, "admin_session"), key);
  if (!session) return { ok: false, response: json({ erro: "Sua sessão administrativa expirou. Entre novamente." }, 401) };
  return { ok: true, actor: { type: "admin", id: session.adminId } };
}

export async function requireClient(request: Request, env: Env): Promise<AuthResult> {
  const key = secret(env);
  if (!key) return { ok: false, response: json({ erro: "Serviço de autenticação indisponível." }, 503) };
  const session = await verificarTokenSessao(getCookie(request, "cliente_session"), key);
  if (!session) return { ok: false, response: json({ erro: "Sua sessão expirou. Entre novamente." }, 401) };
  return { ok: true, actor: { type: "cliente", id: session.clienteId } };
}

export async function requireStaff(request: Request, env: Env): Promise<AuthResult> {
  const key = secret(env);
  if (!key) return { ok: false, response: json({ erro: "Serviço de autenticação indisponível." }, 503) };
  const session = await verificarTokenStaff(getCookie(request, "staff_session"), key);
  if (!session) return { ok: false, response: json({ erro: "Sua sessão da equipe expirou. Entre novamente." }, 401) };
  return { ok: true, actor: { type: "equipe", id: session.staffId, role: session.role } };
}
