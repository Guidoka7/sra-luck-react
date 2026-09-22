import { ClientProfileHeader } from "@/components/cliente/home/ClientProfileHeader";
import { HomeCampaignCarousel } from "@/components/cliente/home/HomeCampaignCarousel";
import { AgendaHome } from "@/components/cliente/home/AgendaHome";
import { DisciplinaCard } from "@/components/cliente/home/DisciplinaCard";
import type { HomeCampaignDestination } from "@/components/cliente/home/homeCampaigns";
import type { DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;

interface HomeTabProps {
  nomeCliente: string;
  procedimento: string | null;
  quantidadeParcelas: number | null;
  porcentagemPagamento: number;
  parcelasPagas: number;
  /** Destino do CTA do carrossel; a navegação fica no shell do app (AgendaPage). */
  onCampaignAction: (destination: HomeCampaignDestination) => void;
  agendamentoAtivo: { id: string; data: string; horario: string | null; dataCirurgia: string | null } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; dataCirurgia: string | null } | null;
  datasDisponiveis: DataDisponivel[];
  podeAgendar: boolean;
  agendaLiberada: boolean;
  statusRevisaoFinanceira: StatusRevisaoFinanceira;
  observacaoRevisaoFinanceira?: string | null;
  /** Fonte de verdade real: clientes.liberacao_financeira_solicitada_em
   * (coluna dedicada) — nunca derivado de statusRevisaoFinanceira. */
  liberacaoFinanceiraSolicitada: boolean;
  custeioAprovado: boolean;
  confirmando: boolean;
  onEscolherData: (dataId: string, horario: string) => void;
  onCusteioSelecionado?: () => void | Promise<void>;
  onAgendaAtualizada?: () => void | Promise<void>;
  onLiberacaoSolicitada?: () => void | Promise<void>;
}

export function HomeTab({
  nomeCliente,
  procedimento,
  quantidadeParcelas,
  porcentagemPagamento,
  parcelasPagas,
  onCampaignAction,
  agendamentoAtivo,
  agendamentoConcluido,
  datasDisponiveis,
  podeAgendar,
  agendaLiberada,
  statusRevisaoFinanceira,
  observacaoRevisaoFinanceira,
  liberacaoFinanceiraSolicitada,
  custeioAprovado,
  confirmando,
  onEscolherData,
  onCusteioSelecionado,
  onAgendaAtualizada,
  onLiberacaoSolicitada,
}: HomeTabProps) {
  return (
    <div>
      <ClientProfileHeader
        nomeCliente={nomeCliente}
        procedimento={procedimento}
        quantidadeParcelas={quantidadeParcelas}
        percentualPago={porcentagemPagamento}
      />

      <HomeCampaignCarousel onAction={(slide) => onCampaignAction(slide.action)} />

      <AgendaHome
        agendamentoAtivo={agendamentoAtivo}
        agendamentoConcluido={agendamentoConcluido}
        datasDisponiveis={datasDisponiveis}
        quantidadeParcelas={quantidadeParcelas}
        parcelasPagas={parcelasPagas}
        podeAgendar={podeAgendar}
        agendaLiberada={agendaLiberada}
        statusRevisaoFinanceira={statusRevisaoFinanceira}
        observacaoRevisaoFinanceira={observacaoRevisaoFinanceira}
        liberacaoFinanceiraSolicitada={liberacaoFinanceiraSolicitada}
        custeioAprovado={custeioAprovado}
        confirmando={confirmando}
        onEscolherData={onEscolherData}
        onCusteioSelecionado={onCusteioSelecionado}
        onAgendaAtualizada={onAgendaAtualizada}
        onLiberacaoSolicitada={onLiberacaoSolicitada}
      />

      <DisciplinaCard />
    </div>
  );
}
