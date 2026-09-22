import { getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";
import { pseudonymizeActorId, requestLogger } from "./logger";

const ADMIN_COOKIE = "admin_session";

function jsonErro(erro: string, status: number) {
  return new Response(JSON.stringify({ erro }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Papéis que podem autenticar no painel administrativo (fora do app de colaboradores). */
export type CargoAdmin = "administrativo" | "gestao" | "financeiro";
const CARGOS_COM_ACESSO_ADMIN = new Set<string>(["administrativo", "gestao", "financeiro"]);

export interface ColaboradorAdmin {
  id: string;
  auth_user_id: string;
  cargo: CargoAdmin;
  ativo: true;
  permissoes: string[];
}

/**
 * Chaves de permissão granular (Fase 8 — RBAC). `administrativo` sempre tem
 * acesso total (é o papel de diretoria/backoffice completo, conforme
 * BUSINESS-RULES.md §16); Gestão e Financeiro precisam da permissão
 * explícita listada em `colaboradores.permissoes` para ações sensíveis.
 * Esconder um botão no frontend nunca substitui esta checagem no Worker.
 */
export const PERMISSOES_ADMIN = {
  CLIENTES_ALTERAR_STATUS_CONTRATO: "clientes.alterar_status_contrato",
  CLIENTES_EXCLUIR: "clientes.excluir",
  CLIENTES_EDITAR: "clientes.editar",
  CLIENTES_LIBERAR_ACESSO_APP: "clientes.liberar_acesso_app",
  AGENDA_GERENCIAR: "agenda.gerenciar",
  CONFIGURACOES_GERENCIAR: "configuracoes.gerenciar",
  FINANCEIRO_REVISAO: "financeiro.revisao",
  FINANCEIRO_BAIXA_MANUAL: "financeiro.baixa_manual",
  FINANCEIRO_VALIDAR_COMPROVANTE: "financeiro.validar_comprovante",
  INTEGRACOES_GERENCIAR_CREDENCIAIS: "integracoes.gerenciar_credenciais",
  INTEGRACOES_OPERAR_FINANCEIRO: "integracoes.operar_financeiro",
  EQUIPE_GERENCIAR: "equipe.gerenciar",
  CREDITO_GERENCIAR: "credito.gerenciar",
  NOTIFICACOES_GERENCIAR: "notificacoes.gerenciar",
  MONITORAMENTO_VISUALIZAR: "monitoramento.visualizar",
  RELATORIOS_EXPORTAR: "relatorios.exportar",
} as const;

export function temPermissaoAdmin(colaborador: ColaboradorAdmin, chave: string): boolean {
  return colaborador.cargo === "administrativo" || colaborador.permissoes.includes(chave);
}

export async function buscarColaboradorAdminAtivo(authUserId: string, env: Env): Promise<ColaboradorAdmin | null> {
  const db = createServiceSupabaseClient(env);
  const { data, error } = await db
    .from("colaboradores")
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

export async function exigirAdmin(request: Request, env: Env): Promise<Response | null> {
  if (!env.CLIENTE_SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    requestLogger(request).fatal("Configuração obrigatória ausente para autorização administrativa", { action: "admin.authorization.validate", eventCode: "ADMIN_AUTH_CONFIG_MISSING", statusCode: 503 });
    return jsonErro("Serviço temporariamente indisponível.", 503);
  }

  const token = getCookie(request, ADMIN_COOKIE);
  const session: AdminSessionPayload | null = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  if (!session) return jsonErro("Sessão administrativa expirada.", 401);

  const log = requestLogger(request).child({ actorType: "admin", actorId: await pseudonymizeActorId(session.adminId, env), action: "admin.authorization.validate" });
  try {
    const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
    if (!colaborador) {
      log.warn("Administrador autenticado sem autorização ativa", { eventCode: "ADMIN_AUTH_DENIED", statusCode: 403 });
      return jsonErro("Acesso administrativo não autorizado.", 403);
    }
  } catch (error) {
    log.error("Falha técnica ao validar autorização administrativa", { eventCode: "ADMIN_AUTH_LOOKUP_FAILED", statusCode: 503, error });
    return jsonErro("Não foi possível validar sua autorização agora.", 503);
  }

  return null;
}
