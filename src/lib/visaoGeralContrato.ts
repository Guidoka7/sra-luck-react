/**
 * Contrato de `GET /api/admin/visao-geral` (versão 2).
 * Compartilhado entre o Worker (`worker/admin-visao-geral.ts`) e a tela
 * (`src/features/admin/visao-geral/`). Somente tipos: nenhuma regra aqui.
 */

/** crítica = prazo operacional vencido; atenção = há trabalho; info = oportunidade; ok = nada pendente. */
export type SeveridadePendencia = "critica" | "atencao" | "info" | "ok";

/** Área do painel onde a pendência é resolvida (a tela traduz em rota + permissão). */
export type AreaPendencia = "financeiro_validacao" | "financeiro" | "agenda" | "clientes";

export type IdPendencia =
  | "liberacoes_cirurgicas"
  | "levantamentos"
  | "registro_termos"
  | "comprovantes"
  | "inadimplencia"
  | "cadastros"
  | "acesso_app"
  | "elegiveis";

export interface ItemPendencia {
  id: string;
  clienteId: string | null;
  nome: string;
  /** Linha principal já formatada (ex.: "Parcela 3/12 · R$ 450,00"). */
  detalhe: string;
  /** Referência temporal já formatada (ex.: "prazo 25/09 · 2 dias em atraso"). */
  meta: string | null;
  atrasado: boolean;
}

export interface Pendencia {
  id: IdPendencia;
  titulo: string;
  descricao: string;
  total: number;
  /** Valor financeiro envolvido, quando a pendência tem um. */
  valor: number | null;
  severidade: SeveridadePendencia;
  area: AreaPendencia;
  itens: ItemPendencia[];
}

export interface EventoAgendaVisaoGeral {
  id: string;
  agendamentoId: string;
  clienteId: string;
  nome: string;
  data: string;
  horario: string | null;
  tipo: "termos" | "cirurgia";
  /** termos: assinado | a_assinar · cirurgia: confirmada | realizada */
  status: "assinado" | "a_assinar" | "confirmada" | "realizada";
}

export type EtapaJornada = "preEligibility" | "financialReview" | "termsConfirmed" | "financialRelease" | "surgeryConfirmed";

export interface MesFinanceiro {
  mes: string; // AAAA-MM
  rotulo: string; // "Set/26"
  previsto: number;
  recebido: number;
  vencido: number;
  futuro: boolean;
}

export interface VisaoGeralAdmin {
  versao: 2;
  geradoEm: string;
  hoje: string;
  periodo: { ano: number; mes: number; inicio: string; fimExclusivo: string; rotulo: string };
  pendencias: Pendencia[];
  financeiro: {
    mes: {
      recebido: number;
      parcelasRecebidas: number;
      receitaAdministrativaRealizada: number;
      receitaAdministrativaPrevista: number;
      vencimentos: { parcelas: number; quitadas: number; valor: number; valorQuitado: number };
    };
    semana: { inicio: string; recebido: number; parcelas: number };
    atraso: { valor: number; parcelas: number; clientes: number; percentualParcelas: number };
    aVencer7: { valor: number; parcelas: number };
    aVencer30: { valor: number; parcelas: number };
    conferencia: { valor: number; parcelas: number };
    serie: MesFinanceiro[];
  };
  carteira: {
    ativas: number;
    suspensas: number;
    negativadas: number;
    canceladas: number;
    creditoContratadoAtivo: number;
    ticketMedio: number;
    novasNoMes: number;
  };
  jornada: {
    etapas: { id: EtapaJornada; rotulo: string; total: number }[];
    elegiveisSemSolicitacao: number;
    concluidasNoMes: number;
  };
  agenda: {
    hoje: EventoAgendaVisaoGeral[];
    proximos: EventoAgendaVisaoGeral[];
    mes: { termos: number; cirurgias: number };
  };
  app: {
    dispositivos: number;
    pwaInstalados: number;
    pwaPercentual: number;
    semAcessoRecente: number;
    webPushConfigurado: boolean;
    pushHoje: number;
  } | null;
  /** Leituras secundárias que falharam: a tela avisa em vez de mostrar zero. */
  avisos: string[];
}
