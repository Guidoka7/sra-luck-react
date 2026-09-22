import { deriveJourneySteps, type JourneyStepsInput } from "@/lib/journeySteps";
import { JourneyStepsView } from "@/components/journey/JourneyStepsView";
import type { NotificacaoCliente } from "@/lib/clientNotifications";

interface JornadaTabProps extends JourneyStepsInput {
  notificacoesCompactas: NotificacaoCliente[];
  onVerNotificacoes: () => void;
}

export function JornadaTab(props: JornadaTabProps) {
  const passos = deriveJourneySteps(props);

  return (
    <div className="sl-tab pb-[10px]">
      <div className="sl-journey-top">
        <div className="flex min-h-[31px] items-center"><img src="/brand/sra-luck-logo.png" alt="Sra. Luck" className="w-[91px] object-contain" /></div>
        <span className="sl-journey-chip">Sua jornada</span>
      </div>

      <div className="flex items-end justify-between gap-3 px-5 pb-2 pt-[19px]">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[.14em] text-[#A9837C]">Passo a passo</div>
          <div className="pt-[2px] font-heading text-[24px] font-semibold leading-[1.08] text-[#2E2422]">Do contrato à sua cirurgia</div>
        </div>
        <div className="text-right text-[9px] font-normal leading-[1.35] text-[#A99894]">Concluído · Agora · Próximos</div>
      </div>

      <div className="px-5">
        <JourneyStepsView passos={passos} variant="app" />
      </div>

      <div className="relative mx-5 mt-[7px] overflow-hidden rounded-[19px] border border-[#EAD8D3] bg-gradient-to-br from-[#F8F0EE] to-[#F4E7E4] px-[17px] py-4">
        <img src="/brand/sra-luck-logo.png" alt="" aria-hidden="true" className="pointer-events-none absolute -right-[63px] -top-2 w-[150px] opacity-[.065]" />
        <div className="relative">
          <div className="font-heading text-[19px] font-semibold leading-[1.2] text-[#6B1F2E]">Você não precisa decorar o processo.</div>
          <div className="max-w-[320px] pt-1 text-[10.8px] font-light leading-[1.5] text-[#866E70]">A Sra. Luck vai destacar sempre a etapa que precisa da sua atenção. O restante fica organizado para você acompanhar com tranquilidade.</div>
          <div className="pt-[9px] text-[9px] font-semibold uppercase tracking-[.13em] text-[#A9837C]">Sra. Luck · ao seu lado em cada etapa</div>
        </div>
      </div>
    </div>
  );
}
