import { ClientProfileHeader } from "@/components/cliente/home/ClientProfileHeader";
import { CardMotivacional } from "@/components/cliente/CardMotivacional";
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
  confirmando: boolean;
  onEscolherData: (dataId: string, horario: string) => void;
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
  confirmando,
  onEscolherData,
}: HomeTabProps) {
  return (
    <div>
      <ClientProfileHeader
        nomeCliente={nomeCliente}
        procedimento={procedimento}
        quantidadeParcelas={quantidadeParcelas}
        naoLidas={naoLidas}
        onAbrirNotificacoes={onAbrirNotificacoes}
      />

      <div className="flex flex-col gap-4 pt-4">
        <CardMotivacional procedimento={procedimento} quantidadeParcelas={quantidadeParcelas} percentualPago={porcentagemPagamento} />

        <AgendaHome
          agendamentoAtivo={agendamentoAtivo}
          agendamentoConcluido={agendamentoConcluido}
          datasDisponiveis={datasDisponiveis}
          quantidadeParcelas={quantidadeParcelas}
          podeAgendar={podeAgendar}
          agendaLiberada={agendaLiberada}
          statusRevisaoFinanceira={statusRevisaoFinanceira}
          observacaoRevisaoFinanceira={observacaoRevisaoFinanceira}
          confirmando={confirmando}
          onEscolherData={onEscolherData}
        />

        <DisciplinaCard />
      </div>
    </div>
  );
}
