"use client";

import { AgendaBloqueadaShell } from "@/components/cliente/AgendaBloqueadaShell";
import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { type DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

type Props = {
  percentual: number;
  parcelasPagas?: number;
  parcelasNecessarias: number | null;
  datas: DataDisponivel[];
  etapa?: Etapa;
};

export function AgendaBloqueadaPercentual({ percentual, parcelasPagas = 0, parcelasNecessarias, datas, etapa = "percentual" }: Props) {
  const atual = etapa === "levantamento" ? "levantamento" : "percentual";
  const pagas = Math.max(0, Math.floor(parcelasPagas));
  const meta = parcelasNecessarias ?? 0;
  const resumo = atual === "levantamento"
    ? "Levantamento financeiro em andamento. Toque para acompanhar."
    : meta > 0
      ? pagas > 0
        ? `Você já confirmou ${Math.min(pagas, meta)} de ${meta} parcelas necessárias para avançar.`
        : `A etapa começa a preencher assim que a primeira das ${meta} parcelas necessárias for confirmada.`
      : `Atinga o percentual mínimo de ${percentual}% do contrato para avançar.`;

  return (
    <AgendaBloqueadaShell datas={datas} etapa={atual === "levantamento" ? 2 : 1} resumo={resumo}>
      <AgendaEtapasInterativas
        atual={atual}
        percentual={percentual}
        parcelasPagas={pagas}
        parcelasNecessarias={parcelasNecessarias}
      />
    </AgendaBloqueadaShell>
  );
}
