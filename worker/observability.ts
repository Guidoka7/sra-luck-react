import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "./middleware/auth.js";
import type { StructuredLogger } from "./middleware/logger.js";

export interface AuditInput {
  actor?: Actor | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId: string;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MetricInput {
  requestId: string;
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  actor?: Actor | null;
}

function safeMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/token|secret|password|senha|authorization|cookie|cpf/i.test(key)) continue;
    output[key] = value;
  }
  return output;
}

export async function recordAudit(db: SupabaseClient, logger: StructuredLogger, input: AuditInput): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor_type: input.actor?.type ?? "sistema",
    actor_id: input.actor?.id ?? null,
    action: input.action.slice(0, 120),
    entity_type: input.entityType.slice(0, 120),
    entity_id: input.entityId?.slice(0, 200) ?? null,
    request_id: input.requestId,
    ip_hash: input.ipHash ?? null,
    metadata: safeMetadata(input.metadata),
  });
  if (error) logger.error("audit_write_failed", error, { action: input.action, entityType: input.entityType });
}

export async function recordMetric(db: SupabaseClient, logger: StructuredLogger, input: MetricInput): Promise<void> {
  const { error } = await db.from("api_request_metrics").insert({
    request_id: input.requestId,
    route: input.route.slice(0, 500),
    method: input.method.slice(0, 12),
    status_code: input.statusCode,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    actor_type: input.actor?.type ?? null,
    actor_id: input.actor?.id ?? null,
  });
  if (error) logger.error("metric_write_failed", error, { route: input.route, status: input.statusCode });
}
