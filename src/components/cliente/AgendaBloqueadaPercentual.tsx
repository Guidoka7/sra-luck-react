"use client";

import { AgendaBloqueadaShell } from "@/components/cliente/AgendaBloqueadaShell";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual: number; parcelasNecessarias: number | null; datas: DataDisponivel[]; etapa?: Etapa }) {
  const atual = etapa === "levantamento" ? "levantamento" : "percentual";
  const resumo = atual === "levantamento"
    ? "Levantamento financeiro em andamento. Toque para acompanhar."
    : `Atinga ${percentual}% das parcelas mínimas para avançar.`;

  return (
    <AgendaBloqueadaShell datas={datas} etapa={atual === "levantamento" ? 2 : 1} resumo={resumo}>
      <AgendaEtapasInterativas
        atual={atual}
        percentual={percentual}
        parcelasNecessarias={parcelasNecessarias}
      />
    </AgendaBloqueadaShell>
  );
}
