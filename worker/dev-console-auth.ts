import { criarTokenAdmin } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

export const DEV_CONSOLE_ADMIN_PREFIX = "dev-console:";
export const DEV_CONSOLE_SYNTHETIC_COLABORADOR_ID = "00000000-0000-4000-8000-000000000046";

const TOKEN_HEADER = "x-dev-console-token";
const ACTOR_HEADER = "x-dev-actor-id";
const ROLE_HEADER = "x-dev-actor-role";

const ALLOWED_EXACT = new Set([
  "/api/admin/session",
  "/api/admin/visao-geral",
  "/api/admin/previsao-liberacoes",
]);

const ALLOWED_PREFIXES = [
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
  "/api/admin/home-campanhas",
];

export type DevConsoleRole = "owner" | "developer" | "operator" | "viewer";

const ROLE_LEVEL: Record<DevConsoleRole, number> = { viewer: 0, operator: 1, developer: 2, owner: 3 };

type MutacaoPermitida = {
  metodo: "POST" | "PUT" | "PATCH" | "DELETE";
  rota: RegExp;
  dominio: string;
  papelMinimo: DevConsoleRole;
};

/**
 * Correções e configurações que o Dev Console pode acionar. A lista é
 * fechada: qualquer mutação fora dela continua bloqueada, mesmo com token
 * válido. As rotas são as mesmas do Admin; nenhuma regra muda.
 *
 * Ficam de fora: equipe/RBAC (o RPC auditado exige um colaborador real),
 * credenciais de integrações e chaves VAPID (segredos), contratos/comissões
 * (FK para colaboradores) e importação de carnês.
 */
const MUTACOES_PERMITIDAS: readonly MutacaoPermitida[] = [
  { metodo: "POST", rota: /^\/api\/admin\/central\/(comparecimento|quitacao|liberar-tentativa|prazo\/ajustar|prazo\/liberar-agora|cirurgia\/pagamento)$/, dominio: "v46", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/financeiro\/validacoes\/[^/]+\/(confirmar|rejeitar)$/, dominio: "financeiro", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/financeiro\/recebiveis\/[^/]+\/(baixa|comprovante)$/, dominio: "financeiro", papelMinimo: "operator" },
  { metodo: "PATCH", rota: /^\/api\/admin\/financeiro\/recebiveis\/[^/]+$/, dominio: "financeiro", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/clientes\/[^/]+\/liberar-acesso-app$/, dominio: "app", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/notificacoes\/automacao$/, dominio: "notificacoes", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/testar-conexao$/, dominio: "integracoes", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/rd-station\/test$/, dominio: "integracoes", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/integrations\/rd-station\/sync$/, dominio: "integracoes", papelMinimo: "developer" },
  { metodo: "PATCH", rota: /^\/api\/admin\/notificacoes\/automacao$/, dominio: "notificacoes", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/notificacoes\/templates$/, dominio: "notificacoes", papelMinimo: "operator" },
  { metodo: "PATCH", rota: /^\/api\/admin\/notificacoes\/templates$/, dominio: "notificacoes", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/notificacoes\/enviar$/, dominio: "notificacoes", papelMinimo: "operator" },
  { metodo: "PATCH", rota: /^\/api\/admin\/configuracoes$/, dominio: "configuracoes", papelMinimo: "developer" },
  { metodo: "POST", rota: /^\/api\/admin\/credit-ops\/club\/(config|referrals\/[^/]+|vouchers\/[^/]+\/arquivo)$/, dominio: "clube", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/credit-ops\/rewards$/, dominio: "clube", papelMinimo: "operator" },
  { metodo: "PATCH", rota: /^\/api\/admin\/credit-ops\/rewards\/[^/]+$/, dominio: "clube", papelMinimo: "operator" },
  { metodo: "DELETE", rota: /^\/api\/admin\/credit-ops\/rewards\/[^/]+$/, dominio: "clube", papelMinimo: "operator" },
  { metodo: "POST", rota: /^\/api\/admin\/home-campanhas$/, dominio: "carrossel", papelMinimo: "operator" },
  { metodo: "PUT", rota: /^\/api\/admin\/home-campanhas\/[a-z0-9-]+$/, dominio: "carrossel", papelMinimo: "operator" },
  { metodo: "DELETE", rota: /^\/api\/admin\/home-campanhas\/[a-z0-9-]+$/, dominio: "carrossel", papelMinimo: "operator" },
];

type ContextoMutacao = { ator: string; papel: DevConsoleRole; metodo: string; rota: string; dominio: string; requestId: string | null };

const contextosMutacao = new WeakMap<Request, ContextoMutacao>();

function escritaHabilitada(env: Env) {
  return ["1", "true", "on", "enabled"].includes(String(env.DEV_CONSOLE_M2M_WRITE || "").trim().toLowerCase());
}

function papelValido(value: string | null): DevConsoleRole | null {
  const papel = String(value || "").trim().toLowerCase();
  return papel in ROLE_LEVEL ? (papel as DevConsoleRole) : null;
}

export function mutacaoPermitida(metodo: string, pathname: string) {
  const m = metodo.toUpperCase();
  return MUTACOES_PERMITIDAS.find((item) => item.metodo === m && item.rota.test(pathname)) ?? null;
}

function json(erro: string, codigo: string, status: number) {
  return new Response(JSON.stringify({ erro, codigo }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function allowedPath(pathname: string) {
  return ALLOWED_EXACT.has(pathname) || ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
 * - Em /api/admin/*: aceita GET/HEAD de uma allowlist explícita.
 * - Mutações só passam quando DEV_CONSOLE_M2M_WRITE está ligado, a rota está
 *   em MUTACOES_PERMITIDAS e o papel do operador no Dev Console é suficiente.
 *   Cada mutação aceita é registrada em logs_alteracoes com o ator técnico.
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

  const leitura = ["GET", "HEAD"].includes(request.method.toUpperCase());
  const mutacao = leitura ? null : mutacaoPermitida(request.method, pathname);

  if (!leitura) {
    if (!escritaHabilitada(env)) {
      return json("A integração técnica está restrita a consultas.", "DEV_CONSOLE_M2M_READ_ONLY", 403);
    }
    if (!mutacao) {
      return json("Esta correção não está liberada para o Dev Console.", "DEV_CONSOLE_MUTATION_NOT_ALLOWED", 403);
    }
  } else if (!allowedPath(pathname)) {
    return json("Rota não autorizada para a integração técnica.", "DEV_CONSOLE_ROUTE_NOT_ALLOWED", 403);
  }

  const supplied = presented.trim();
  if (!supplied || !(await safeEqual(supplied, expected))) {
    return json("Credencial técnica inválida.", "DEV_CONSOLE_TOKEN_INVALID", 401);
  }

  const actor = normalizeActor(request.headers.get(ACTOR_HEADER));
  const papel = papelValido(request.headers.get(ROLE_HEADER));
  if (mutacao && (!papel || ROLE_LEVEL[papel] < ROLE_LEVEL[mutacao.papelMinimo])) {
    return json("O papel do operador no Dev Console não permite esta correção.", "DEV_CONSOLE_ROLE_INSUFFICIENT", 403);
  }

  const session = await criarTokenAdmin(`${DEV_CONSOLE_ADMIN_PREFIX}${actor}`, env.CLIENTE_SESSION_SECRET);
  const autorizado = withAdminCookie(request, session);
  if (mutacao && papel) {
    contextosMutacao.set(autorizado, {
      ator: actor,
      papel,
      metodo: request.method.toUpperCase(),
      rota: pathname,
      dominio: mutacao.dominio,
      requestId: request.headers.get("x-request-id"),
    });
  }
  return autorizado;
}

/**
 * Registra no histórico oficial (logs_alteracoes) quem, no Dev Console,
 * acionou a correção e qual foi o resultado. Nunca interrompe a resposta.
 */
export async function registrarMutacaoDevConsole(request: Request, response: Response, env: Env) {
  const contexto = contextosMutacao.get(request);
  if (!contexto) return;
  try {
    const db = createServiceSupabaseClient(env);
    await db.from("logs_alteracoes").insert({
      usuario: `${DEV_CONSOLE_ADMIN_PREFIX}${contexto.ator}`,
      acao: "dev_console_correcao",
      entidade: "dev_console",
      entidade_id: null,
      detalhes: {
        metodo: contexto.metodo,
        rota: contexto.rota,
        dominio: contexto.dominio,
        papel: contexto.papel,
        status_http: response.status,
        sucesso: response.ok,
        request_id: contexto.requestId,
      },
    });
  } catch {
    // Auditoria complementar: a ação já foi auditada pelo próprio domínio e pelo Dev Console.
  }
}
