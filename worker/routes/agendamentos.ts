import type { Env } from "../supabase.js";
import { createServiceSupabaseClient } from "../supabase.js";
import { requireAdmin, requireSameOrigin } from "../middleware/auth.js";
import type { StructuredLogger } from "../middleware/logger.js";
import { parseJsonObject, requiredString, validateInteger, validateIsoDate, ValidationError } from "../validation.js";
import { recordAudit } from "../observability.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function validTime(value: unknown, field: string): string {
  const time = requiredString(value, field, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ValidationError(`${field} deve estar no formato HH:MM.`, field);
  return time;
}

export async function schedulingRoutes(request: Request, env: Env, logger: StructuredLogger, requestId: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/agenda-janelas") return null;
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const db = createServiceSupabaseClient(env);

  if (request.method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 50)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const query = db.from("agenda_janelas").select("id,tipo,data,horario_inicio,horario_fim,vagas,status,observacao,created_at", { count: "exact" })
      .gte("data", new Date().toISOString().slice(0, 10))
      .order("data", { ascending: true })
      .order("horario_inicio", { ascending: true })
      .range(from, to);
    const { data, error, count } = await query;
    if (error) {
      logger.error("agenda_windows_list_failed", error, { requestId });
      return json({ erro: "Não foi possível carregar as janelas da agenda." }, 500);
    }
    return json({ itens: data ?? [], pagina: page, porPagina: pageSize, total: count ?? 0 });
  }

  if (request.method === "POST") {
    const origin = requireSameOrigin(request);
    if (origin) return origin;
    try {
      const body = await parseJsonObject(request);
      const tipo = requiredString(body.tipo, "tipo", 20);
      if (tipo !== "termos" && tipo !== "cirurgia") throw new ValidationError("Tipo de agenda inválido.", "tipo");
      const row = {
        tipo,
        data: validateIsoDate(body.data, "data"),
        horario_inicio: validTime(body.horarioInicio, "horário inicial"),
        horario_fim: body.horarioFim ? validTime(body.horarioFim, "horário final") : null,
        vagas: validateInteger(body.vagas ?? 1, "vagas", 1, 100),
        status: "disponivel",
        observacao: typeof body.observacao === "string" ? body.observacao.trim().slice(0, 1000) : null,
      };
      const { data, error } = await db.from("agenda_janelas").upsert(row, { onConflict: "tipo,data,horario_inicio" }).select("*").single();
      if (error) throw error;
      await recordAudit(db, logger, { actor: auth.actor, action: "agenda.window.upsert", entityType: "agenda_janela", entityId: String(data.id), requestId, metadata: { tipo, data: row.data } });
      return json({ janela: data }, 201);
    } catch (error) {
      logger.error("agenda_window_write_failed", error, { requestId });
      if (error instanceof ValidationError) return json({ erro: error.userMessage }, 400);
      return json({ erro: "Não foi possível salvar a janela da agenda." }, 500);
    }
  }

  return json({ erro: "Método não permitido." }, 405);
}
