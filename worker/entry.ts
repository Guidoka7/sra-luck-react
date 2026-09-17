import baseWorker from "./index";
import { adminDevBuilder } from "./admin-dev-builder";
import type { Env } from "./supabase";

/**
 * Entry incremental do Worker para o DEV Builder.
 * As rotas existentes continuam delegadas integralmente a worker/index.ts.
 * Quando o Builder for consolidado no roteador principal, este wrapper pode ser removido.
 */
export default {
  async fetch(request: Request, env: Env) {
    const builderResponse = await adminDevBuilder(request, env);
    if (builderResponse) return builderResponse;
    return baseWorker.fetch(request, env);
  },
} satisfies ExportedHandler<Env>;
