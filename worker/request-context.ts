import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./supabase";
import type { ColaboradorAdmin } from "./admin-auth";

// Weak keys keep the lifetime tied to the request. Never store a client row,
// permissions, or session state in an isolate-wide cache.
export interface RequestContext {
  requestId: string;
  startedAt: number;
  clienteId?: string;
  cliente?: Record<string, any>;
  admin?: ColaboradorAdmin;
  db?: SupabaseClient;
  authMs: number;
  authorizationMs: number;
  dbCalls: number;
  rpcCalls: number;
  dbDurationMs: number;
  dbResponseBytes: number;
  dbBytesUnknown: number;
  dbErrors: number;
  duplicateCalls: number;
  queries: Map<string, number>;
  route: string;
}

const contexts = new WeakMap<Request, RequestContext>();

export function beginRequest(request: Request, requestId: string): RequestContext {
  const context: RequestContext = {
    requestId, startedAt: performance.now(), authMs: 0, authorizationMs: 0,
    dbCalls: 0, rpcCalls: 0, dbDurationMs: 0, dbResponseBytes: 0,
    dbErrors: 0, duplicateCalls: 0, dbBytesUnknown: 0, queries: new Map(),
    route: new URL(request.url).pathname.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ":id"),
  };
  contexts.set(request, context);
  return context;
}

export function requestContext(request: Request): RequestContext | undefined {
  return contexts.get(request);
}

export function timedSupabaseFetch(context: RequestContext): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const fingerprint = `${method}:${url.pathname}?${url.searchParams.toString()}`;
    const seen = context.queries.get(fingerprint) ?? 0;
    context.queries.set(fingerprint, seen + 1);
    if (seen > 0) context.duplicateCalls++;
    context.dbCalls++;
    if (url.pathname.includes("/rpc/")) context.rpcCalls++;
    const start = performance.now();
    try {
      const response = await fetch(input, init);
      context.dbDurationMs += performance.now() - start;
      const length = response.headers.get("content-length");
      if (length !== null) context.dbResponseBytes += Number(length);
      else context.dbBytesUnknown++;
      if (!response.ok) context.dbErrors++;
      return response;
    } catch (error) {
      context.dbDurationMs += performance.now() - start;
      context.dbErrors++;
      throw error;
    }
  };
}

export function withPerformance(request: Request, response: Response, env: Env): Response {
  const context = requestContext(request);
  const headers = new Headers(response.headers);
  const path = new URL(request.url).pathname;
  if (/^\/api\/(cliente|admin|equipe|monitoramento)(?:\/|$)/.test(path)) {
    // Também vale no Worker direto, fora das regras de headers do Vercel.
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
  }
  if (!context || env.LOAD_TEST_TELEMETRY !== "1") {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const elapsedMs = performance.now() - context.startedAt;
  headers.set("Server-Timing", [
    `auth;dur=${context.authMs.toFixed(1)}`,
    `authorization;dur=${context.authorizationMs.toFixed(1)}`,
    `db;dur=${context.dbDurationMs.toFixed(1)}`,
    `total;dur=${elapsedMs.toFixed(1)}`,
  ].join(", "));
  headers.set("X-Loadtest-DB-Calls", String(context.dbCalls));
  headers.set("X-Loadtest-RPC-Calls", String(context.rpcCalls));
  headers.set("X-Loadtest-DB-Bytes", String(context.dbResponseBytes));
  headers.set("X-Loadtest-DB-Bytes-Unknown", String(context.dbBytesUnknown));
  headers.set("X-Loadtest-DB-Duplicates", String(context.duplicateCalls));
  const payloadBytes = Number(headers.get("content-length") || 0);
  // Only metadata, never URL parameters, SQL values, tokens or client data.
  // k6 receives counters for every response; logs are sampled to bound cost.
  if (Math.random() < 0.01) console.info(JSON.stringify({ event: "request_performance", requestId: context.requestId,
    route: context.route, status: response.status, dbCalls: context.dbCalls,
    rpcCalls: context.rpcCalls, dbDurationMs: Math.round(context.dbDurationMs),
    dbBytes: context.dbResponseBytes, dbBytesUnknown: context.dbBytesUnknown,
    payloadBytes: payloadBytes || null, duplicates: context.duplicateCalls,
    dbErrors: context.dbErrors, authMs: Math.round(context.authMs),
    authorizationMs: Math.round(context.authorizationMs), totalMs: Math.round(elapsedMs) }));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
