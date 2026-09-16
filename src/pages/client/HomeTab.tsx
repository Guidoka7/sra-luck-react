import { ClientProfileHeader } from "@/components/cliente/home/ClientProfileHeader";
import { AgendaHome } from "@/components/cliente/home/AgendaHome";
import { DisciplinaCard } from "@/components/cliente/home/DisciplinaCard";
import type { DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type StatusRevisaoFinanceira = "pendente" | "aprovada" | "recusada" | null;

interface HomeTabProps {
  nomeCliente: string;
  procedimento: string | null;
  quantidadeParcelas: number | null;
  porcentagemPagamento: number;
  naoLidas: number;
  onAbrirNotificacoes: () => void;
  agendamentoAtivo: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null } | null;
  agendamentoConcluido: { id: string; data: string; horario: string | null; previsaoLiberacaoFinanceira: string | null } | null;
  datasDisponiveis: DataDisponivel[];
  podeAgendar: boolean;
  agendaLiberada: boolean;
  statusRevisaoFinanceira: StatusRevisaoFinanceira;
  observacaoRevisaoFinanceira?: string | null;
  custeioAprovado: boolean;
  confirmando: boolean;
  onEscolherData: (dataId: string, horario: string) => void;
  onCusteioSelecionado?: () => void | Promise<void>;
}

export function HomeTab({
  nomeCliente,
  procedimento,
  quantidadeParcelas,
  porcentagemPagamento,
  naoLidas,
  onAbrirNotificacoes,
  agendamentoAtivo,
  agendamentoConcluido,
  datasDisponiveis,
  podeAgendar,
  agendaLiberada,
  statusRevisaoFinanceira,
  observacaoRevisaoFinanceira,
  custeioAprovado,
  confirmando,
  onEscolherData,
  onCusteioSelecionado,
}: HomeTabProps) {
  return (
    <div>
      <ClientProfileHeader
        nomeCliente={nomeCliente}
        procedimento={procedimento}
        quantidadeParcelas={quantidadeParcelas}
        percentualPago={porcentagemPagamento}
        naoLidas={naoLidas}
        onAbrirNotificacoes={onAbrirNotificacoes}
      />

      <AgendaHome
        agendamentoAtivo={agendamentoAtivo}
        agendamentoConcluido={agendamentoConcluido}
        datasDisponiveis={datasDisponiveis}
        quantidadeParcelas={quantidadeParcelas}
        percentualPago={porcentagemPagamento}
        podeAgendar={podeAgendar}
        agendaLiberada={agendaLiberada}
        statusRevisaoFinanceira={statusRevisaoFinanceira}
        observacaoRevisaoFinanceira={observacaoRevisaoFinanceira}
        custeioAprovado={custeioAprovado}
        confirmando={confirmando}
        onEscolherData={onEscolherData}
        onCusteioSelecionado={onCusteioSelecionado}
      />

      <DisciplinaCard />
    </div>
  );
}
