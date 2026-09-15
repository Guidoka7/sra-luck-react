import worker from "./index";
import type { Env } from "./supabase";
import { sanitizeErrorResponse } from "./response-security";
import { applyApiSecurityHeaders, enforceStreamingRequestSize } from "./security";
import { getRequestId, withRequestId } from "./logger";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = getRequestId(request);
    const sizeDenied = await enforceStreamingRequestSize(request);
    if (sizeDenied) {
      return sanitizeErrorResponse(applyApiSecurityHeaders(withRequestId(sizeDenied, requestId), request));
    }
    const response = await worker.fetch(request, env);
    return sanitizeErrorResponse(response);
  },
} satisfies ExportedHandler<Env>;
