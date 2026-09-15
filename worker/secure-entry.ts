import worker from "./index";
import type { Env } from "./supabase";
import { sanitizeErrorResponse } from "./response-security";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await worker.fetch(request, env, ctx);
    return sanitizeErrorResponse(response);
  },
} satisfies ExportedHandler<Env>;
