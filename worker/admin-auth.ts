import { getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { pseudonymizeActorId, requestLogger } from "./logger";

const ADMIN_COOKIE = "admin_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function jsonErro(erro: string, status: number) {
  return new Response(JSON.stringify({ erro }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export type CargoAdmin = "administrativo" | "gestao" | "financeiro";
const CARGOS_COM_ACESSO_ADMIN = new Set<string>(["administrativo", "gestao", "financeiro"]);

export interface ColaboradorAdmin {
  id: string;
  auth_user_id: string;
  cargo: CargoAdmin;
  ativo: true;
  permissoes: string[];
}

export const PERMISSOES_ADMIN = {
  CLIENTES_EDITAR: "clientes.editar",
  CLIENTES_ALTERAR_STATUS_CONTRATO: "clientes.alterar_status_contrato",
  CLIENTES_EXCLUIR: "clientes.excluir",
  FINANCEIRO_GERENCIAR_PLANO: "financeiro.gerenciar_plano",
  FINANCEIRO_BAIXA_MANUAL: "financeiro.baixa_manual",
  FINANCEIRO_VALIDAR_COMPROVANTE: "financeiro.validar_comprovante",
  AGENDA_GERENCIAR: "agenda.gerenciar",
  CONFIGURACOES_GERENCIAR: "configuracoes.gerenciar",
  INTEGRACOES_GERENCIAR_CREDENCIAIS: "integracoes.gerenciar_credenciais",
  EQUIPE_GERENCIAR: "equipe.gerenciar",
  RELATORIOS_EXPORTAR: "relatorios.exportar",
} as const;

export function temPermissaoAdmin(colaborador: ColaboradorAdmin, chave: string): boolean {
  return colaborador.cargo === "administrativo" || colaborador.permissoes.includes(chave);
}

export async function buscarColaboradorAdminAtivo(authUserId: string, env: Env): Promise<ColaboradorAdmin | null> {
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db.from("colaboradores")
    .select("id,auth_user_id,cargo,ativo,permissoes")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.ativo !== true || !CARGOS_COM_ACESSO_ADMIN.has(String(data.cargo))) return null;
  return {
    id: String(data.id),
    auth_user_id: String(data.auth_user_id),
    cargo: data.cargo as CargoAdmin,
    ativo: true,
    permissoes: Array.isArray(data.permissoes) ? data.permissoes.filter((item): item is string => typeof item === "string") : [],
  };
}

export async function obterAdminAtivo(request: Request, env: Env): Promise<{ session: AdminSessionPayload; colaborador: ColaboradorAdmin } | Response> {
  if (!env.CLIENTE_SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    requestLogger(request).fatal("Configuração obrigatória ausente para autorização administrativa", { action: "admin.authorization.validate", eventCode: "ADMIN_AUTH_CONFIG_MISSING", statusCode: 503 });
    return jsonErro("Serviço temporariamente indisponível.", 503);
  }
  const session = await verificarTokenAdmin(getCookie(request, ADMIN_COOKIE), env.CLIENTE_SESSION_SECRET);
  if (!session) return jsonErro("Sessão administrativa expirada.", 401);
  const log = requestLogger(request).child({ actorType: "admin", actorId: await pseudonymizeActorId(session.adminId, env), action: "admin.authorization.validate" });
  try {
    const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
    if (!colaborador) {
      log.warn("Administrador autenticado sem autorização ativa", { eventCode: "ADMIN_AUTH_DENIED", statusCode: 403 });
      return jsonErro("Acesso administrativo não autorizado.", 403);
    }
    return { session, colaborador };
  } catch (error) {
    log.error("Falha técnica ao validar autorização administrativa", { eventCode: "ADMIN_AUTH_LOOKUP_FAILED", statusCode: 503, error });
    return jsonErro("Não foi possível validar sua autorização agora.", 503);
  }
}

/**
 * Defesa em profundidade: mesmo uma rota antiga/fallback não pode contornar o
 * RBAC apenas por ter sido registrada antes de um handler especializado.
 */
export function permissaoObrigatoriaParaRota(request: Request): string | null {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;
  const path = new URL(request.url).pathname;

  if (/^\/api\/admin\/clientes\/[^/]+\/status-contrato$/.test(path)) return PERMISSOES_ADMIN.CLIENTES_ALTERAR_STATUS_CONTRATO;
  if (/^\/api\/admin\/clientes\/[^/]+$/.test(path) && method === "DELETE") return PERMISSOES_ADMIN.CLIENTES_EXCLUIR;
  if (path === "/api/admin/clientes" && method === "POST") return PERMISSOES_ADMIN.CLIENTES_EDITAR;
  if (/^\/api\/admin\/clientes\/[^/]+$/.test(path) && method === "PATCH") return PERMISSOES_ADMIN.CLIENTES_EDITAR;

  if (/^\/api\/admin\/clientes\/[^/]+\/(parcelas|boletos)$/.test(path)) return PERMISSOES_ADMIN.FINANCEIRO_GERENCIAR_PLANO;
  if (/^\/api\/admin\/clientes\/[^/]+\/revisao-financeira$/.test(path)) return PERMISSOES_ADMIN.FINANCEIRO_GERENCIAR_PLANO;
  if (path === "/api/admin/boletos/lote" || /^\/api\/admin\/boletos\/[^/]+$/.test(path)) return PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL;
  if (path.startsWith("/api/admin/financeiro/")) return PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL;
  if (path === "/api/admin/solicitacoes-liberacao-financeira" && method !== "GET") return PERMISSOES_ADMIN.FINANCEIRO_GERENCIAR_PLANO;

  if (path === "/api/admin/datas" || /^\/api\/admin\/datas\/[^/]+$/.test(path)) return PERMISSOES_ADMIN.AGENDA_GERENCIAR;
  if (path === "/api/admin/datas-liberacao-financeira") return PERMISSOES_ADMIN.AGENDA_GERENCIAR;
  if (path === "/api/admin/remarcacoes") return PERMISSOES_ADMIN.AGENDA_GERENCIAR;
  if (path === "/api/admin/agendamentos-termos" || /^\/api\/admin\/agendamentos\/[^/]+\/(ciclo|previsao)$/.test(path)) return PERMISSOES_ADMIN.AGENDA_GERENCIAR;

  if (path === "/api/admin/configuracoes") return PERMISSOES_ADMIN.CONFIGURACOES_GERENCIAR;
  return null;
}

export async function exigirAdmin(request: Request, env: Env): Promise<Response | null> {
  const result = await obterAdminAtivo(request, env);
  if (result instanceof Response) return result;
  const permissao = permissaoObrigatoriaParaRota(request);
  if (permissao && !temPermissaoAdmin(result.colaborador, permissao)) {
    requestLogger(request).warn("Ação administrativa sensível bloqueada por RBAC global", {
      action: "admin.authorization.route_permission",
      actorType: "admin",
      actorId: await pseudonymizeActorId(result.session.adminId, env),
      eventCode: "ADMIN_ROUTE_PERMISSION_DENIED",
      statusCode: 403,
      permission: permissao,
    });
    return jsonErro("Seu papel não tem permissão para realizar esta ação.", 403);
  }
  return null;
}

export async function exigirPermissaoAdmin(request: Request, env: Env, permissao: string): Promise<{ colaborador: ColaboradorAdmin; session: AdminSessionPayload } | Response> {
  const result = await obterAdminAtivo(request, env);
  if (result instanceof Response) return result;
  if (!temPermissaoAdmin(result.colaborador, permissao)) {
    requestLogger(request).warn("Ação administrativa bloqueada por RBAC", {
      action: "admin.authorization.permission",
      actorType: "admin",
      actorId: await pseudonymizeActorId(result.session.adminId, env),
      eventCode: "ADMIN_PERMISSION_DENIED",
      statusCode: 403,
      permission: permissao,
    });
    return jsonErro("Seu papel não tem permissão para realizar esta ação.", 403);
  }
  return result;
}
