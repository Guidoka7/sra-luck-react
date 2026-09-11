export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogPrimitive = string | number | boolean | null;
export type LogValue = LogPrimitive | LogValue[] | { [key: string]: LogValue };

export interface LogContext {
  requestId?: string;
  route?: string;
  method?: string;
  actorType?: string;
  actorId?: string;
  provider?: string;
  operation?: string;
  durationMs?: number;
  status?: number | string;
  [key: string]: LogValue | undefined;
}

export interface StructuredLogger {
  child(context: LogContext): StructuredLogger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
}

const SECRET_KEYS = /(authorization|token|secret|password|senha|api[_-]?key|cookie|cpf|client[_-]?secret)/i;
const MAX_DEPTH = 5;

function errorDetails(error: unknown): { name: string; message: string; stack?: string } | undefined {
  if (!(error instanceof Error)) return undefined;
  return {
    name: error.name,
    message: error.message.slice(0, 1000),
    stack: error.stack?.slice(0, 4000),
  };
}

function sanitize(value: unknown, depth = 0): LogValue {
  if (depth >= MAX_DEPTH) return "[limite]";
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? value.slice(0, 4000) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const result: { [key: string]: LogValue } = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SECRET_KEYS.test(key) ? "[redigido]" : sanitize(item, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, 1000);
}

class JsonLogger implements StructuredLogger {
  constructor(private readonly baseContext: LogContext = {}) {}

  child(context: LogContext): StructuredLogger {
    return new JsonLogger({ ...this.baseContext, ...context });
  }

  debug(message: string, context?: LogContext): void { this.write("debug", message, undefined, context); }
  info(message: string, context?: LogContext): void { this.write("info", message, undefined, context); }
  warn(message: string, context?: LogContext): void { this.write("warn", message, undefined, context); }
  error(message: string, error?: unknown, context?: LogContext): void { this.write("error", message, error, context); }

  private write(level: LogLevel, message: string, error?: unknown, context?: LogContext): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message: message.slice(0, 1000),
      context: sanitize({ ...this.baseContext, ...(context ?? {}) }),
      error: errorDetails(error),
    };
    globalThis.console.info(JSON.stringify(payload));
  }
}

export function createLogger(context: LogContext = {}): StructuredLogger {
  return new JsonLogger(context);
}

export const logger = createLogger({ service: "sra-luck-worker" });
