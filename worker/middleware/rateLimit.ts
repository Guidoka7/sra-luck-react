import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../supabase.js";
import type { Actor } from "./auth.js";
import type { StructuredLogger } from "./logger.js";

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
  scope: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function clampPolicy(policy: RateLimitPolicy): RateLimitPolicy {
  return {
    scope: policy.scope.replace(/[^a-z0-9:_-]/gi, "").slice(0, 80) || "global",
    limit: Math.min(10_000, Math.max(1, Math.trunc(policy.limit))),
    windowSeconds: Math.min(86_400, Math.max(1, Math.trunc(policy.windowSeconds))),
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export async function ipRateLimitKey(request: Request, env: Env, scope: string): Promise<string> {
  const salt = env.CLIENTE_SESSION_SECRET?.trim() || "sra-luck-rate-limit";
  return `${scope}:ip:${await sha256(`${salt}:${clientIp(request)}`)}`;
}

export async function actorRateLimitKey(actor: Actor, env: Env, scope: string): Promise<string> {
  const salt = env.CLIENTE_SESSION_SECRET?.trim() || "sra-luck-rate-limit";
  return `${scope}:${actor.type}:${await sha256(`${salt}:${actor.id}`)}`;
}

export async function checkRateLimit(
  db: SupabaseClient,
  key: string,
  policyInput: RateLimitPolicy,
  logger: StructuredLogger,
): Promise<RateLimitDecision> {
  const policy = clampPolicy(policyInput);
  const { data, error } = await db.rpc("check_rate_limit", {
    p_key: key.slice(0, 200),
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  });
  if (error) {
    logger.error("rate_limit_backend_failed", error, { scope: policy.scope });
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.min(policy.windowSeconds, 30) };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
  return {
    allowed: record.allowed === true,
    remaining: Number.isFinite(Number(record.remaining)) ? Math.max(0, Number(record.remaining)) : 0,
    retryAfterSeconds: Number.isFinite(Number(record.retry_after_seconds)) ? Math.max(1, Number(record.retry_after_seconds)) : policy.windowSeconds,
  };
}

export function rateLimitResponse(decision: RateLimitDecision): Response {
  return new Response(JSON.stringify({ erro: "Muitas requisições em pouco tempo. Aguarde alguns instantes e tente novamente." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(decision.retryAfterSeconds),
      "X-RateLimit-Remaining": String(decision.remaining),
    },
  });
}
