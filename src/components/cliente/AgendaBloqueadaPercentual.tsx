"use client";

import { AgendaBloqueadaShell } from "@/components/cliente/AgendaBloqueadaShell";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

type Props = {
  percentual: number;
  percentualPago?: number;
  parcelasNecessarias: number | null;
  datas: DataDisponivel[];
  etapa?: Etapa;
};

export function AgendaBloqueadaPercentual({ percentual, percentualPago, parcelasNecessarias, datas, etapa = "percentual" }: Props) {
  const atual = etapa === "levantamento" ? "levantamento" : "percentual";
  const resumo = atual === "levantamento"
    ? "Levantamento financeiro em andamento. Toque para acompanhar."
    : percentualPago != null
      ? `Você já atingiu ${Math.min(100, Math.max(0, Math.round(percentualPago)))}% do contrato. A meta desta etapa é ${percentual}%.`
      : `Atinga o percentual mínimo de ${percentual}% do contrato para avançar.`;

  return (
    <AgendaBloqueadaShell datas={datas} etapa={atual === "levantamento" ? 2 : 1} resumo={resumo}>
      <AgendaEtapasInterativas
        atual={atual}
        percentual={percentual}
        percentualPago={percentualPago}
        parcelasNecessarias={parcelasNecessarias}
      />
    </AgendaBloqueadaShell>
  );
}
