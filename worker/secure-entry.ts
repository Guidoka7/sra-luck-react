import worker from "./index";
import type { Env } from "./supabase";
import { sanitizeErrorResponse } from "./response-security";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await worker.fetch(request, env);
    return sanitizeErrorResponse(response);
  },
} satisfies ExportedHandler<Env>;
