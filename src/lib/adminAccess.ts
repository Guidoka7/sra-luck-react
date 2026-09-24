import { useEffect, useState } from "react";

export const ADMIN_PERMISSIONS = {
  VISAO_GERAL_VER: "visao_geral.ver",
  AGENDA_VER: "agenda.ver",
  CLIENTES_VER: "clientes.ver",
  CRM_IMPORTAR: "crm.importar",
  FINANCEIRO_VER: "financeiro.ver",
  CLUBE_VER: "clube.ver",
  PREVISOES_VER: "previsoes.ver",
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
  RELATORIOS_VISUALIZAR: "relatorios.visualizar",
  RELATORIOS_EXPORTAR: "relatorios.exportar",
} as const;

export interface AdminAccessProfile {
  cargo: string | null;
  permissoes: string[];
  acessoTotal: boolean;
}

export function pode(profile: AdminAccessProfile | null | undefined, ...permissoes: string[]) {
  if (!profile) return true;
  return profile.acessoTotal || permissoes.some((p) => profile.permissoes.includes(p));
}

export const FINANCE_PERMISSIONS = [
  ADMIN_PERMISSIONS.FINANCEIRO_REVISAO,
  ADMIN_PERMISSIONS.FINANCEIRO_BAIXA_MANUAL,
  ADMIN_PERMISSIONS.FINANCEIRO_VALIDAR_COMPROVANTE,
] as const;

export const CLIENT_PERMISSIONS = [
  ADMIN_PERMISSIONS.CLIENTES_VER,
  ADMIN_PERMISSIONS.CLIENTES_EDITAR,
  ADMIN_PERMISSIONS.CLIENTES_ALTERAR_STATUS_CONTRATO,
  ADMIN_PERMISSIONS.CLIENTES_EXCLUIR,
  ADMIN_PERMISSIONS.CLIENTES_LIBERAR_ACESSO_APP,
  ...FINANCE_PERMISSIONS,
  ADMIN_PERMISSIONS.AGENDA_GERENCIAR,
] as const;

let sessaoAdmin: Promise<AdminAccessProfile | null> | null = null;

/** Perfil da sessão do painel (uma busca por carregamento de página). */
export function carregarPerfilAdmin(): Promise<AdminAccessProfile | null> {
  if (!sessaoAdmin) {
    sessaoAdmin = fetch("/api/admin/session", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.autenticado ? { cargo: d.cargo ?? null, permissoes: Array.isArray(d.permissoes) ? d.permissoes : [], acessoTotal: d.acessoTotal === true || d.cargo === "administrativo" } : null))
      .catch(() => null);
  }
  return sessaoAdmin;
}

/**
 * true só para o cargo Administrativo. Usado para a operação das integrações
 * (RD Station, Conta Azul), que não pode ser concedida a outros cargos.
 */
export function useAcessoTotalAdmin() {
  const [total, setTotal] = useState(false);
  useEffect(() => { let ativo = true; void carregarPerfilAdmin().then((p) => { if (ativo) setTotal(Boolean(p?.acessoTotal)); }); return () => { ativo = false; }; }, []);
  return total;
}
