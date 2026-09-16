"use client";

import { AgendaEtapasInterativas } from "@/components/cliente/AgendaEtapasInterativas";
import { CalendarioAgendamento, DataDisponivel } from "@/components/cliente/CalendarioAgendamento";

type Etapa = "percentual" | "levantamento";

export function AgendaBloqueadaPercentual({ percentual, parcelasNecessarias, datas, etapa = "percentual" }: { percentual: number; parcelasNecessarias: number | null; datas: DataDisponivel[]; etapa?: Etapa }) {
  const atual = etapa === "levantamento" ? "levantamento" : "percentual";

  return (
    <section className="relative min-h-[395px] overflow-hidden rounded-[18px] border border-[#EFE4E1] bg-white shadow-[0_10px_26px_rgba(70,42,44,.07)]">
      <div className={`pointer-events-none select-none p-[14px] ${atual === "percentual" ? "opacity-[.42] blur-[2.2px]" : "opacity-[.58] blur-[1.35px]"}`}>
        <CalendarioAgendamento datas={datas} onConfirmar={() => {}} confirmando={false} bloqueado />
      </div>

      <div className="absolute inset-x-[12px] top-[16px]">
        <div className="w-full rounded-[18px] border border-[#E7D4AE] bg-white/95 px-[15px] pb-[13px] pt-[14px] shadow-[0_15px_34px_rgba(95,54,58,.12)] backdrop-blur-[3px]">
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
