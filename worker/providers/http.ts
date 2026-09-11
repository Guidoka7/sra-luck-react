import type { Env } from "../supabase.js";
import { fetchWithRetry, type Fetcher } from "../middleware/retry.js";
import type { StructuredLogger } from "../middleware/logger.js";
import type { JsonObject, JsonValue, ProviderContext } from "./types.js";

export interface ProviderHttpDependencies {
  fetcher?: Fetcher;
  logger: StructuredLogger;
  timeoutMs?: number;
}

export function asJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") output[key] = item;
    else if (Array.isArray(item)) output[key] = item.map(toJsonValue);
    else if (typeof item === "object") output[key] = asJsonObject(item);
  }
  return output;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") return asJsonObject(value);
  return String(value);
}

export function readPath(value: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

export function readString(value: unknown, ...paths: string[]): string | null {
  for (const path of paths) {
    const candidate = readPath(value, path);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

export function readNumber(value: unknown, ...paths: string[]): number | null {
  for (const path of paths) {
    const candidate = readPath(value, path);
    const number = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate.replace(",", ".")) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function envValue(env: Env, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function parseJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text();
  if (!text.trim()) return {};
  try { return asJsonObject(JSON.parse(text)); } catch { return { rawText: text.slice(0, 4000) }; }
}

export async function providerFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  context: ProviderContext,
  dependencies: ProviderHttpDependencies,
  operation: string,
): Promise<{ response: Response; data: JsonObject }> {
  const logger = dependencies.logger.child({
    requestId: context.requestId,
    actorType: context.actorType,
    actorId: context.actorId,
    operation,
  });
  const response = await fetchWithRetry(
    input,
    init,
    { attempts: 3, timeoutMs: dependencies.timeoutMs ?? 10_000, logger, operation },
    dependencies.fetcher ?? fetch,
  );
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const message = readString(data, "message", "error.message", "error", "detail") ?? `HTTP ${response.status}`;
    logger.warn("provider_response_rejected", { status: response.status, providerMessage: message.slice(0, 500) });
    throw new Error(`O provedor recusou a operação (${response.status}).`);
  }
  return { response, data };
}
