import worker from "./index";
import type { Env } from "./supabase";
import { sanitizeErrorResponse } from "./response-security";
import { applyApiSecurityHeaders, enforceStreamingRequestSize } from "./security";
import { getRequestId, withRequestId } from "./logger";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = getRequestId(request);
    const guarded = await enforceStreamingRequestSize(request);
    if (guarded.denied) {
      return sanitizeErrorResponse(applyApiSecurityHeaders(withRequestId(guarded.denied, requestId), request));
    }
    const response = await worker.fetch(guarded.request, env);
    return sanitizeErrorResponse(response);
  },
} satisfies ExportedHandler<Env>;
