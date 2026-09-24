import { PERMISSOES_ADMIN as P, temPermissaoAdmin, type ColaboradorAdmin } from "./admin-auth";

/**
 * Autorização por aba (catálogo em src/lib/permissoesEquipe.ts).
 * Leitura: a permissão "ver" da aba OU qualquer ação dela.
 * Escrita: somente as ações (ligar só "ver" = somente leitura).
 * Os handlers continuam checando a ação exata quando ela é sensível
 * (ex.: excluir cliente, baixa manual); esta camada fecha a aba inteira.
 */
const FINANCE = [P.FINANCEIRO_REVISAO, P.FINANCEIRO_BAIXA_MANUAL, P.FINANCEIRO_VALIDAR_COMPROVANTE];
const FINANCE_VER = [P.FINANCEIRO_VER, ...FINANCE];
const CLIENTS_ACOES = [P.CLIENTES_EDITAR, P.CLIENTES_ALTERAR_STATUS_CONTRATO, P.CLIENTES_EXCLUIR, P.CLIENTES_LIBERAR_ACESSO_APP];
// O drawer da cliente mostra financeiro e jornada: quem opera essas abas também lê a cliente.
const CLIENTS = [P.CLIENTES_VER, ...CLIENTS_ACOES, ...FINANCE, P.AGENDA_GERENCIAR];
const AGENDA_VER = [P.AGENDA_VER, P.AGENDA_GERENCIAR];
const CLUBE_VER = [P.CLUBE_VER, P.CREDITO_GERENCIAR];

/** Read authorization at the router. */
export function adminReadPermissions(path: string): readonly string[] | null {
  if (path === "/api/admin/session" || path === "/api/admin/regras-operacionais") return null;
  if (/^\/api\/admin\/(staff(?:\/|$)|credit-ops\/team(?:\/|$))/.test(path)) return [P.EQUIPE_GERENCIAR];
  if (/^\/api\/admin\/(monitoramento-app|monitoramento-erros|monitoramento-storage|monitoramento-admin|monitoramento-cliente\/[^/]+|diagnostico)$/.test(path)) return [P.MONITORAMENTO_VISUALIZAR];
  // Status das conexões: leitura de qualquer pessoa do painel (Notificações, Gerais).
  if (path === "/api/admin/integrations/status") return null;
  // Operação das integrações: só Administrativo (as chaves abaixo não são concedíveis).
  if (/^\/api\/admin\/integrations\/rd-station\/importacoes(?:\/|$)/.test(path)) return [P.CRM_IMPORTAR];
  if (/^\/api\/admin\/integrations\/conta-azul\/(painel|conflitos|fila|vinculos|historico)$/.test(path)) return [P.INTEGRACOES_OPERAR_FINANCEIRO];
  if (/^\/api\/admin\/integrations(?:\/|$)/.test(path)) return [P.INTEGRACOES_GERENCIAR_CREDENCIAIS];
  if (/^\/api\/admin\/notificacoes(?:\/|$)/.test(path)) return [P.NOTIFICACOES_GERENCIAR];
  if (/^\/api\/admin\/relatorios(?:\/|$)/.test(path)) return [P.RELATORIOS_VISUALIZAR, P.RELATORIOS_EXPORTAR];
  if (path === "/api/admin/configuracoes") return [P.CONFIGURACOES_GERENCIAR];
  if (/^\/api\/admin\/home-campanhas(?:\/|$)/.test(path)) return [P.CONFIGURACOES_GERENCIAR];
  if (path === "/api/admin/credit-ops/finance/daily") return FINANCE_VER;
  if (/^\/api\/admin\/credit-ops(?:\/|$)/.test(path)) return CLUBE_VER;
  if (/^\/api\/admin\/clientes\/[^/]+\/(boletos|parcelas|carnes|importacoes-boletos)$/.test(path)) return [...FINANCE_VER, P.CLIENTES_VER];
  if (/^\/api\/admin\/clientes\/[^/]+\/leitor-carne(?:\/(folhas|importar))?$/.test(path)) return FINANCE;
  if (/^\/api\/admin\/(financeiro|boletos|importacoes-boletos)(?:\/|$)/.test(path)) return FINANCE_VER;
  if (/^\/api\/admin\/(liberacoes-financeiras|solicitacoes-liberacao-financeira)$/.test(path)) return [P.FINANCEIRO_VER, P.FINANCEIRO_REVISAO, ...AGENDA_VER];
  if (/^\/api\/admin\/(central|journey)(?:\/|$)/.test(path)) return [...AGENDA_VER, ...FINANCE_VER];
  if (/^\/api\/admin\/(previsao-liberacoes|previsoes-liberacoes|previsoes-liberacao)(?:\/|$)/.test(path)) return [P.PREVISOES_VER, ...AGENDA_VER, P.RELATORIOS_VISUALIZAR];
  if (/^\/api\/admin\/(datas(?:-liberacao-financeira)?|agendamentos(?:-termos)?|cirurgias-confirmadas|liberacao-inteligente|remarcacoes|agenda-mensal|clientes-agendamentos)(?:\/|$)/.test(path)) return [...AGENDA_VER, P.PREVISOES_VER, P.RELATORIOS_VISUALIZAR];
  if (/^\/api\/admin\/(clientes|novas-vendas)(?:\/|$)/.test(path)) return CLIENTS;
  if (path === "/api/admin/visao-geral") return [P.VISAO_GERAL_VER, P.RELATORIOS_VISUALIZAR];
  return null;
}

/**
 * Escrita por aba (POST/PUT/PATCH/DELETE). Retorna null quando a rota já tem
 * autorização própria (sessão, notificações, equipe, integrações do Dev,
 * regras operacionais) ou não pertence a uma aba.
 */
export function adminWritePermissions(path: string): readonly string[] | null {
  if (/^\/api\/admin\/(session|auth|logout|regras-operacionais|staff|notificacoes|monitoramento|diagnostico)(?:[-/]|$)/.test(path)) return null;
  if (/^\/api\/admin\/integrations\/rd-station\/(importar|importacoes\/)/.test(path)) return [P.CRM_IMPORTAR];
  if (/^\/api\/admin\/integrations\/conta-azul\/(conflitos\/|fila\/|sincronizar$|enviar-cliente$|vincular$)/.test(path)) return [P.INTEGRACOES_OPERAR_FINANCEIRO];
  if (/^\/api\/admin\/integrations(?:\/|$)/.test(path)) return null; // área do Dev (admin-rotas-dev.ts)
  if (/^\/api\/admin\/(configuracoes|home-campanhas)(?:\/|$)/.test(path)) return [P.CONFIGURACOES_GERENCIAR];
  if (/^\/api\/admin\/relatorios(?:\/|$)/.test(path)) return [P.RELATORIOS_VISUALIZAR, P.RELATORIOS_EXPORTAR];
  if (/^\/api\/admin\/credit-ops\/finance(?:\/|$)/.test(path)) return FINANCE;
  if (/^\/api\/admin\/credit-ops(?:\/|$)/.test(path)) return [P.CREDITO_GERENCIAR];
  if (/^\/api\/admin\/clientes\/[^/]+\/(boletos|parcelas|carnes|importacoes-boletos|leitor-carne)(?:\/|$)/.test(path)) return FINANCE;
  if (/^\/api\/admin\/(financeiro|boletos|importacoes-boletos)(?:\/|$)/.test(path)) return FINANCE;
  if (/^\/api\/admin\/(liberacoes-financeiras|solicitacoes-liberacao-financeira)(?:\/|$)/.test(path)) return [P.FINANCEIRO_REVISAO, P.AGENDA_GERENCIAR];
  if (/^\/api\/admin\/(central|journey)(?:\/|$)/.test(path)) return [P.AGENDA_GERENCIAR, ...FINANCE];
  if (/^\/api\/admin\/(previsao-liberacoes|previsoes-liberacoes|previsoes-liberacao|datas(?:-liberacao-financeira)?|agendamentos(?:-termos)?|cirurgias-confirmadas|liberacao-inteligente|remarcacoes|agenda-mensal|clientes-agendamentos)(?:\/|$)/.test(path)) return [P.AGENDA_GERENCIAR];
  if (/^\/api\/admin\/(clientes|novas-vendas)(?:\/|$)/.test(path)) return [...CLIENTS_ACOES, ...FINANCE, P.AGENDA_GERENCIAR];
  return null;
}

export function canReadAdminRoute(colaborador: ColaboradorAdmin, path: string): boolean {
  const permissions = adminReadPermissions(path);
  return permissions === null || permissions.some((p) => temPermissaoAdmin(colaborador, p));
}

export function canWriteAdminRoute(colaborador: ColaboradorAdmin, path: string): boolean {
  const permissions = adminWritePermissions(path);
  return permissions === null || permissions.some((p) => temPermissaoAdmin(colaborador, p));
}
