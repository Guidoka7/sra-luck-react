import { getCookie, verificarTokenAdmin, type AdminSessionPayload } from "./session";
import { createServiceSupabaseClient, type Env } from "./supabase";

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
  FINANCEIRO_BAIXA_MANUAL: "financeiro.baixa_manual",
  FINANCEIRO_VALIDAR_COMPROVANTE: "financeiro.validar_comprovante",
  INTEGRACOES_GERENCIAR_CREDENCIAIS: "integracoes.gerenciar_credenciais",
  EQUIPE_GERENCIAR: "equipe.gerenciar",
  RELATORIOS_EXPORTAR: "relatorios.exportar",
} as const;

export function temPermissaoAdmin(colaborador: ColaboradorAdmin, chave: string): boolean {
  return colaborador.cargo === "administrativo" || colaborador.permissoes.includes(chave);
}

/**
 * Fonte de verdade server-side para autorização administrativa.
 *
 * Autenticação (Supabase Auth) prova identidade; esta consulta prova autorização.
 * Nunca confiar em cargo/role recebido do frontend ou armazenado em localStorage.
 */
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
    return jsonErro("Serviço temporariamente indisponível.", 503);
  }

  const token = getCookie(request, ADMIN_COOKIE);
  const session: AdminSessionPayload | null = await verificarTokenAdmin(token, env.CLIENTE_SESSION_SECRET);
  if (!session) {
    return jsonErro("Sessão administrativa expirada.", 401);
  }

  try {
    const colaborador = await buscarColaboradorAdminAtivo(session.adminId, env);
    if (!colaborador) {
      return jsonErro("Acesso administrativo não autorizado.", 403);
    }
  } catch (error) {
    console.error("Falha ao validar autorização administrativa:", error);
    return jsonErro("Não foi possível validar sua autorização agora.", 503);
  }

  return null;
}
