import { criarTokenAdmin } from "./session";
import type { Env } from "./supabase";

export const DEV_CONSOLE_ADMIN_PREFIX = "dev-console:";
export const DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID = "00000000-0000-4000-8000-000000000046";

const TOKEN_HEADER = "x-dev-console-token";
const ACTOR_HEADER = "x-dev-actor-id";
const ROLE_HEADER = "x-dev-actor-role";
const MAX_MUTATION_BODY_BYTES = 4_096;

const ALLOWED_READ_EXACT = new Set([
  "/api/admin/session",
  "/api/admin/visao-geral",
  "/api/admin/previsao-liberacoes",
]);

const ALLOWED_READ_PREFIXES = [
  "/api/admin/central/",
  "/api/admin/financeiro/",
  "/api/admin/credit-ops/finance/",
  "/api/admin/credit-ops/club",
  "/api/admin/credit-ops/rewards",
  "/api/admin/monitoramento",
  "/api/admin/diagnostico",
  "/api/admin/notificacoes/",
  "/api/admin/integrations/",
  "/api/admin/staff",
  "/api/admin/configuracoes",
  "/api/admin/clientes",
];

const ALLOWED_NOTIFICATION_ACTIONS = new Set([
  "verificar_atrasos",
  "verificar_momentos_especiais",
]);

const ALLOWED_INTEGRATION_PROVIDERS = new Set([
  "gemini",
  "mercado_pago",
]);

/**
 * Central de Notificações (lotes). Cada rota tem um escopo explícito e um
 * payload fechado. Nenhuma delas altera dado financeiro: só prepara, aprova,
 * envia ou cancela NOTIFICAÇÕES, sempre pelas regras do backend.
 */
type EscopoLote = "READ" | "PREPARE" | "APPROVE" | "SEND" | "CANCEL" | "CONFIG";

const LOTE_ID = "[0-9a-f-]{36}";
const ROTAS_LOTE: readonly { rota: RegExp; escopo: EscopoLote; chaves: readonly string[]; obrigatorias?: readonly string[] }[] = [
  { rota: /^\/api\/admin\/notificacoes\/lotes\/preparar$/, escopo: "PREPARE", chaves: [] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/gerar$`), escopo: "PREPARE", chaves: ["instrucao", "segmento"] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/itens/${LOTE_ID}/editar$`), escopo: "PREPARE", chaves: ["mensagem"], obrigatorias: ["mensagem"] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/chat$`), escopo: "READ", chaves: ["mensagem", "historico"], obrigatorias: ["mensagem"] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/explicar$`), escopo: "READ", chaves: [] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/aprovar$`), escopo: "APPROVE", chaves: [] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/reprocessar-falhas$`), escopo: "SEND", chaves: [] },
  { rota: new RegExp(`^/api/admin/notificacoes/lotes/${LOTE_ID}/cancelar$`), escopo: "CANCEL", chaves: [] },
  { rota: /^\/api\/admin\/notificacoes\/lotes\/config$/, escopo: "CONFIG", chaves: ["ativa", "janelaDedupHoras", "silencioInicio", "silencioFim", "aprovacaoObrigatoria", "segmentos"] },
];

/** Papel mínimo do operador no Dev Console por escopo (viewer nunca muda nada). */
const PAPEL_POR_ESCOPO: Record<EscopoLote, readonly string[]> = {
  READ: ["owner", "developer", "operator"],
  PREPARE: ["owner", "developer", "operator"],
  APPROVE: ["owner", "developer", "operator"],
  SEND: ["owner", "developer", "operator"],
  CANCEL: ["owner", "developer", "operator"],
  CONFIG: ["owner", "developer"],
};

function json(erro: string, codigo: string, status: number) {
  return new Response(JSON.stringify({ erro, codigo }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function allowedReadPath(pathname: string) {
  return ALLOWED_READ_EXACT.has(pathname) || ALLOWED_READ_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function normalizeActor(value: string | null) {
  const actor = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(actor) ? actor : "service";
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function safeEqual(a: string, b: string) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function withAdminCookie(request: Request, token: string) {
  const headers = new Headers(request.headers);
  const existing = String(headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("admin_session="));
  existing.push(`admin_session=${token}`);
  headers.set("cookie", existing.join("; "));
  headers.delete(TOKEN_HEADER);
  headers.delete(ACTOR_HEADER);
  headers.delete(ROLE_HEADER);
  return new Request(request, { headers });
}

function stripTechnicalHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete(TOKEN_HEADER);
  headers.delete(ACTOR_HEADER);
  headers.delete(ROLE_HEADER);
  return new Request(request, { headers });
}

function hasExactKeys(body: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(body).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

async function validateAllowedMutation(request: Request, pathname: string): Promise<Response | null> {
  if (request.method.toUpperCase() !== "POST") {
    return json(
      "Esta mutação não é permitida para a integração técnica.",
      "DEV_CONSOLE_M2M_MUTATION_NOT_ALLOWED",
      403,
    );
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_MUTATION_BODY_BYTES) {
    return json("Payload técnico muito grande.", "DEV_CONSOLE_M2M_PAYLOAD_TOO_LARGE", 413);
  }

  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return json(
      "A mutação técnica exige application/json.",
      "DEV_CONSOLE_M2M_CONTENT_TYPE_REQUIRED",
      415,
    );
  }

  let parsed: unknown;
  try {
    parsed = await request.clone().json();
  } catch {
    return json("Payload técnico inválido.", "DEV_CONSOLE_M2M_PAYLOAD_INVALID", 400);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json("Payload técnico inválido.", "DEV_CONSOLE_M2M_PAYLOAD_INVALID", 400);
  }
  const body = parsed as Record<string, unknown>;

  if (pathname === "/api/admin/notificacoes/automacao") {
    if (!hasExactKeys(body, ["acao"])) {
      return json(
        "Payload não autorizado para a rotina de notificações.",
        "DEV_CONSOLE_M2M_PAYLOAD_NOT_ALLOWED",
        403,
      );
    }
    const acao = typeof body.acao === "string" ? body.acao : "";
    if (!ALLOWED_NOTIFICATION_ACTIONS.has(acao)) {
      return json(
        "Ação de notificação não autorizada para a integração técnica.",
        "DEV_CONSOLE_M2M_ACTION_NOT_ALLOWED",
        403,
      );
    }
    return null;
  }

  if (pathname === "/api/admin/integrations/testar-conexao") {
    if (!hasExactKeys(body, ["provedor"])) {
      return json(
        "Payload não autorizado para o teste de integração.",
        "DEV_CONSOLE_M2M_PAYLOAD_NOT_ALLOWED",
        403,
      );
    }
    const provedor = typeof body.provedor === "string" ? body.provedor : "";
    if (!ALLOWED_INTEGRATION_PROVIDERS.has(provedor)) {
      return json(
        "Provedor não autorizado para teste pela integração técnica.",
        "DEV_CONSOLE_M2M_PROVIDER_NOT_ALLOWED",
        403,
      );
    }
    return null;
  }

  const papel = String(request.headers.get(ROLE_HEADER) || "").trim().toLowerCase();

  if (pathname === "/api/admin/integrations/gemini/mensagem-do-dia") {
    if (!["owner", "developer", "operator"].includes(papel) || !hasExactKeys(body, [])) {
      return json("Operação do Gemini não autorizada para a integração técnica.", "DEV_CONSOLE_M2M_GEMINI_NOT_ALLOWED", 403);
    }
    return null;
  }

  if (pathname === "/api/admin/integrations/gemini/sugerir") {
    const chaves = Object.keys(body);
    if (!["owner", "developer", "operator"].includes(papel)
      || chaves.some((k) => k !== "pedido")
      || (body.pedido !== undefined && (typeof body.pedido !== "string" || body.pedido.length > 200))) {
      return json("Payload não autorizado para o chat do Gemini.", "DEV_CONSOLE_M2M_GEMINI_NOT_ALLOWED", 403);
    }
    return null;
  }

  if (pathname === "/api/admin/integrations/gemini/definir") {
    const chaves = Object.keys(body);
    const origemOk = body.origem === undefined || body.origem === "ia" || body.origem === "admin";
    const modeloOk = body.modelo === undefined || (typeof body.modelo === "string" && body.modelo.length <= 80);
    if (!["owner", "developer", "operator"].includes(papel)
      || chaves.some((k) => !["texto", "origem", "modelo"].includes(k))
      || typeof body.texto !== "string"
      || body.texto.length < 1
      || body.texto.length > 300
      || !origemOk
      || !modeloOk) {
      return json("Payload não autorizado para publicar a mensagem do dia.", "DEV_CONSOLE_M2M_GEMINI_NOT_ALLOWED", 403);
    }
    return null;
  }

  const lote = ROTAS_LOTE.find((r) => r.rota.test(pathname));
  if (lote) {
    const papel = String(request.headers.get(ROLE_HEADER) || "").trim().toLowerCase();
    if (!PAPEL_POR_ESCOPO[lote.escopo].includes(papel)) {
      return json("O papel do operador no Dev Console não permite esta ação.", "DEV_CONSOLE_M2M_ROLE_NOT_ALLOWED", 403);
    }
    const chaves = Object.keys(body);
    if (chaves.some((k) => !lote.chaves.includes(k)) || (lote.obrigatorias ?? []).some((k) => !(k in body))) {
      return json("Payload não autorizado para a Central de Notificações.", "DEV_CONSOLE_M2M_PAYLOAD_NOT_ALLOWED", 403);
    }
    const textoLongo = (v: unknown, max: number) => v !== undefined && (typeof v !== "string" || v.length > max);
    if (textoLongo(body.instrucao, 300) || textoLongo(body.segmento, 40) || textoLongo(body.mensagem, 400)) {
      return json("Payload não autorizado para a Central de Notificações.", "DEV_CONSOLE_M2M_PAYLOAD_NOT_ALLOWED", 403);
    }
    if (body.historico !== undefined && (!Array.isArray(body.historico) || body.historico.length > 8)) {
      return json("Payload não autorizado para a Central de Notificações.", "DEV_CONSOLE_M2M_PAYLOAD_NOT_ALLOWED", 403);
    }
    return null;
  }

  return json(
    "Rota de mutação não autorizada para a integração técnica.",
    "DEV_CONSOLE_M2M_MUTATION_NOT_ALLOWED",
    403,
  );
}

export function isDevConsoleSyntheticAdminId(value: string) {
  return value.startsWith(DEV_CONSOLE_ADMIN_PREFIX)
    && value.length > DEV_CONSOLE_ADMIN_PREFIX.length
    && value.length <= DEV_CONSOLE_ADMIN_PREFIX.length + 128;
}

/**
 * Autenticação server-to-server do Dev Console.
 *
 * - Sem header técnico: mantém o fluxo normal do Admin intacto.
 * - Em rotas não administrativas: remove headers técnicos e segue normalmente.
 * - Leituras administrativas: somente GET/HEAD em uma allowlist explícita.
 * - Mutações administrativas: somente POST em rotas explícitas (duas rotinas,
 *   teste de integração e a Central de Notificações por escopo), com payload
 *   validado campo a campo antes de criar a sessão técnica.
 * - Após validar o segredo, converte a identidade técnica em uma sessão admin
 *   assinada e efêmera, consumida pelos guardrails já existentes do Worker.
 */
export async function authorizeDevConsoleRequest(request: Request, env: Env): Promise<Request | Response> {
  const presented = request.headers.get(TOKEN_HEADER);
  if (!presented) return request;

  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/admin/")) return stripTechnicalHeaders(request);

  const expected = String(env.DEV_CONSOLE_SERVICE_TOKEN || "").trim();
  if (expected.length < 32 || !env.CLIENTE_SESSION_SECRET) {
    return json("Integração técnica indisponível.", "DEV_CONSOLE_M2M_NOT_CONFIGURED", 503);
  }

  const supplied = presented.trim();
  if (!supplied || !(await safeEqual(supplied, expected))) {
    return json("Credencial técnica inválida.", "DEV_CONSOLE_TOKEN_INVALID", 401);
  }

  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    if (!allowedReadPath(pathname)) {
      return json("Rota não autorizada para a integração técnica.", "DEV_CONSOLE_ROUTE_NOT_ALLOWED", 403);
    }
  } else {
    const mutationError = await validateAllowedMutation(request, pathname);
    if (mutationError) return mutationError;
  }

  const actor = normalizeActor(request.headers.get(ACTOR_HEADER));
  const session = await criarTokenAdmin(`${DEV_CONSOLE_ADMIN_PREFIX}${actor}`, env.CLIENTE_SESSION_SECRET);
  return withAdminCookie(request, session);
}
