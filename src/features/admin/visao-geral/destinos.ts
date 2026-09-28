import { ADMIN_PERMISSIONS as P, CLIENT_PERMISSIONS, FINANCE_PERMISSIONS, pode, type AdminAccessProfile } from "@/lib/adminAccess";
import type { AreaPendencia, EventoAgendaVisaoGeral, IdPendencia, ItemPendencia } from "@/lib/visaoGeralContrato";

/**
 * Onde cada pendência da Visão geral é resolvida. As permissões são as mesmas
 * da sidebar (AdminZipShell): um link só aparece para quem abre o destino.
 */
const FINANCEIRO = [P.FINANCEIRO_VER, ...FINANCE_PERMISSIONS];
const AGENDA = [P.AGENDA_VER, P.AGENDA_GERENCIAR];

export const DESTINO_AREA: Record<AreaPendencia, { href: string; rotulo: string; permissoes: readonly string[] }> = {
  financeiro_validacao: { href: "/admin/financeiro/avancado?aba=validacao", rotulo: "Abrir validação", permissoes: FINANCEIRO },
  financeiro: { href: "/admin/financeiro", rotulo: "Abrir Financeiro", permissoes: FINANCEIRO },
  agenda: { href: "/admin/agenda", rotulo: "Abrir na Agenda", permissoes: AGENDA },
  clientes: { href: "/admin/clientes", rotulo: "Abrir Clientes", permissoes: CLIENT_PERMISSIONS },
};

/** Pendências da agenda abrem direto na etapa correspondente da Jornada. */
const ETAPA_DA_PENDENCIA: Partial<Record<IdPendencia, string>> = {
  elegiveis: "preEligibility",
  levantamentos: "financialReview",
  registro_termos: "financialRelease",
  liberacoes_cirurgicas: "financialRelease",
};

export function hrefArea(perfil: AdminAccessProfile | null, area: AreaPendencia, pendencia?: IdPendencia) {
  const destino = DESTINO_AREA[area];
  if (!pode(perfil, ...destino.permissoes)) return null;
  const etapa = area === "agenda" && pendencia ? ETAPA_DA_PENDENCIA[pendencia] : undefined;
  return etapa ? `${destino.href}?etapa=${etapa}` : destino.href;
}

/** Item com cliente abre a busca de Clientes já filtrada; senão, a área da pendência. */
export function hrefItem(perfil: AdminAccessProfile | null, area: AreaPendencia, item: ItemPendencia, pendencia?: IdPendencia) {
  if (area === "financeiro_validacao" || area === "agenda") return hrefArea(perfil, area, pendencia);
  if (item.clienteId && pode(perfil, ...CLIENT_PERMISSIONS)) return `/admin/clientes?busca=${encodeURIComponent(item.nome)}`;
  return hrefArea(perfil, area);
}

export function hrefEvento(perfil: AdminAccessProfile | null, evento: EventoAgendaVisaoGeral) {
  if (!pode(perfil, ...AGENDA)) return null;
  return `/admin/agenda?aba=${evento.tipo === "cirurgia" ? "cirurgia" : "termos"}&data=${evento.data}`;
}

export function podeBuscarClientes(perfil: AdminAccessProfile | null) {
  return pode(perfil, ...CLIENT_PERMISSIONS);
}

export function hrefAgenda(perfil: AdminAccessProfile | null) {
  return pode(perfil, ...AGENDA) ? "/admin/agenda" : null;
}

export function hrefFinanceiro(perfil: AdminAccessProfile | null) {
  return pode(perfil, ...FINANCEIRO) ? "/admin/financeiro/avancado?aba=visao-geral" : null;
}
