import { PERMISSOES_ADMIN as P, temPermissaoAdmin, type ColaboradorAdmin } from "./admin-auth";

const FINANCE = [P.FINANCEIRO_REVISAO, P.FINANCEIRO_BAIXA_MANUAL, P.FINANCEIRO_VALIDAR_COMPROVANTE];
const CLIENTS = [P.CLIENTES_EDITAR, P.CLIENTES_ALTERAR_STATUS_CONTRATO, P.CLIENTES_EXCLUIR, P.CLIENTES_LIBERAR_ACESSO_APP, ...FINANCE, P.AGENDA_GERENCIAR];

/** Read authorization at the router; mutations retain their exact handler permission. */
export function adminReadPermissions(path: string): readonly string[] | null {
  if (path === "/api/admin/session") return null;
  if (/^\/api\/admin\/(staff(?:\/|$)|credit-ops\/team(?:\/|$))/.test(path)) return [P.EQUIPE_GERENCIAR];
  if (/^\/api\/admin\/(monitoramento-app|monitoramento-erros|diagnostico)$/.test(path)) return [P.MONITORAMENTO_VISUALIZAR];
  if (/^\/api\/admin\/integrations(?:\/|$)/.test(path)) return [P.INTEGRACOES_GERENCIAR_CREDENCIAIS];
  if (/^\/api\/admin\/notificacoes(?:\/|$)/.test(path)) return [P.NOTIFICACOES_GERENCIAR];
  if (/^\/api\/admin\/relatorios(?:\/|$)/.test(path)) return [P.RELATORIOS_VISUALIZAR, P.RELATORIOS_EXPORTAR];
  if (path === "/api/admin/configuracoes") return [P.CONFIGURACOES_GERENCIAR];
  if (path === "/api/admin/credit-ops/finance/daily") return FINANCE;
  if (/^\/api\/admin\/credit-ops(?:\/|$)/.test(path)) return [P.CREDITO_GERENCIAR];
  if (/^\/api\/admin\/clientes\/[^/]+\/(boletos|parcelas|carnes|importacoes-boletos)$/.test(path)) return FINANCE;
  if (/^\/api\/admin\/(financeiro|boletos|importacoes-boletos)(?:\/|$)/.test(path)) return FINANCE;
  if (/^\/api\/admin\/(liberacoes-financeiras|solicitacoes-liberacao-financeira)$/.test(path)) return [P.FINANCEIRO_REVISAO, P.AGENDA_GERENCIAR];
  if (/^\/api\/admin\/(central|journey)(?:\/|$)/.test(path)) return [P.AGENDA_GERENCIAR, ...FINANCE];
  if (/^\/api\/admin\/(datas(?:-liberacao-financeira)?|agendamentos(?:-termos)?|cirurgias-confirmadas|liberacao-inteligente|remarcacoes|agenda-mensal|clientes-agendamentos|previsao-liberacoes|previsoes-liberacoes)(?:\/|$)/.test(path)) return [P.AGENDA_GERENCIAR, P.RELATORIOS_VISUALIZAR];
  if (/^\/api\/admin\/(clientes|novas-vendas)(?:\/|$)/.test(path)) return CLIENTS;
  if (path === "/api/admin/visao-geral") return [P.RELATORIOS_VISUALIZAR];
  return null;
}

export function canReadAdminRoute(colaborador: ColaboradorAdmin, path: string): boolean {
  const permissions = adminReadPermissions(path);
  return permissions === null || permissions.some((p) => temPermissaoAdmin(colaborador, p));
}
