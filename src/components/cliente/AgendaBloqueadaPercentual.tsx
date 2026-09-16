"use client";

import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual: number; parcelasNecessarias: number | null; datas: DataDisponivel[]; etapa?: Etapa }) {
  const atual = etapa === "levantamento" ? "levantamento" : "percentual";

  return (
    <section className="relative min-h-[395px] overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      <div className={`pointer-events-none select-none p-[14px] ${atual === "percentual" ? "opacity-[.42] blur-[2.4px]" : "opacity-[.55] blur-[1.6px]"}`}>
        <CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado />
      </div>

      <div className="absolute inset-[14px] flex items-center justify-center">
        <div className="w-full max-w-[355px] rounded-[18px] border border-[#E7D4AE] bg-white/92 px-[14px] pb-[14px] pt-[13px] shadow-[0_18px_42px_rgba(95,54,58,.13)] backdrop-blur-[2px]">
          <AgendaEtapasInterativas
            atual={atual}
            percentual={percentual}
            parcelasNecessarias={parcelasNecessarias}
          />
        </div>
      </div>
    </section>
  );
}
