const INTERNAL_ERROR = "Não foi possível concluir a operação agora. Tente novamente.";
const DB_INTERNAL_RE = /(duplicate key|violates? .*constraint|constraint .*violat|relation .* does not exist|column .* does not exist|permission denied|row-level security|invalid input syntax|sqlstate|pgrst\d*|postgres|schema cache|null value in column|foreign key|unique constraint|syntax error at or near)/i;
const SECRETISH_RE = /(service[_-]?role|authorization|bearer\s+|access[_-]?token|refresh[_-]?token|password|senha|secret|cookie|jwt)/i;

function safeClientMessage(status: number, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 500);
  if (!text) return null;
  if (status >= 500 || DB_INTERNAL_RE.test(text) || SECRETISH_RE.test(text)) return INTERNAL_ERROR;
  return text;
}

/**
 * Última barreira contra vazamento de mensagens do Supabase/Postgres/provedores.
 * Mantém mensagens de validação de negócio 4xx, mas nunca devolve detalhes
 * internos em 5xx ou mensagens reconhecidamente técnicas.
 */
export async function sanitizeErrorResponse(response: Response): Promise<Response> {
  if (response.status < 400) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return response;

  let parsed: any;
  try { parsed = await response.clone().json(); }
  catch { return response; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return response;

  const out: Record<string, unknown> = {};
  // Só expomos campos públicos conhecidos. Isso elimina stack, hint, details,
  // code/providerBody e quaisquer campos inesperados adicionados por engano.
  if ("erro" in parsed || "error" in parsed) {
    const raw = parsed.erro ?? parsed.error;
    out.erro = safeClientMessage(response.status, raw) ?? INTERNAL_ERROR;
  } else if ("message" in parsed) {
    out.message = safeClientMessage(response.status, parsed.message) ?? INTERNAL_ERROR;
  } else {
    return response;
  }

  for (const key of ["ok", "status", "agendaCirurgicaLiberarEm", "autenticado", "code"] as const) {
    if (key in parsed && typeof parsed[key] !== "object") out[key] = parsed[key];
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(out), { status: response.status, statusText: response.statusText, headers });
}
