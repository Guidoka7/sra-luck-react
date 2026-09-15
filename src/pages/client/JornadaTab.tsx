import { Check } from "lucide-react";
import { deriveJourneySteps, type JourneyStepsInput } from "@/lib/journeySteps";
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
        {passos.map((passo, indice) => {
          const done = passo.status === "done";
          const current = passo.status === "current";
          const tag = done ? "Concluído" : current ? "Agora" : "Próximo";
          const card = done
            ? { background: "#F8FBF8", border: "#DCE9DF", shadow: "none" }
            : current
              ? { background: "#FFF", border: "#DFC9C4", shadow: "0 8px 22px rgba(72,42,45,.08)" }
              : { background: "#FBF9F8", border: "#EEE6E3", shadow: "none" };
          const badge = done
            ? { background: "#EDF6EF", border: "#CFE2D4", color: "#3F7D5B" }
            : current
              ? { background: "#7D2434", border: "#7D2434", color: "#FFF" }
              : { background: "#FBF7F5", border: "#D9CCC8", color: "#A99894" };
          const tagStyle = done
            ? { background: "#EAF4EC", color: "#3F7D5B", border: "#D4E7D8" }
            : current
              ? { background: "#F7EFED", color: "#7D2434", border: "#E7D1CC" }
              : { background: "#F4F0EE", color: "#9A8D89", border: "#E9E1DE" };

          return (
            <div key={passo.id} className="flex items-stretch gap-[11px]">
              <div className="flex w-[34px] flex-none flex-col items-center">
                <div style={{ width: 28, height: 28, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", border: `1px solid ${badge.border}`, background: badge.background, color: badge.color, fontSize: 10, fontWeight: 600 }}>
                  {done ? <Check className="h-[14px] w-[14px]" strokeWidth={1.8} /> : <span>{indice + 1}</span>}
                </div>
                {indice < passos.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 14, background: done ? "#D9E8DD" : "#E9DDDA" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0, marginBottom: 10, padding: "11px 12px", borderRadius: 15, background: card.background, border: `1px solid ${card.border}`, boxShadow: card.shadow }}>
                <div className="flex items-start justify-between gap-[9px]">
                  <div className="min-w-0">
                    <div className="text-[8px] font-semibold uppercase tracking-[.12em]" style={{ color: done ? "#6E9A7D" : current ? "#B65B67" : "#A99894" }}>Etapa {indice + 1}</div>
                    <div className="pt-[2px] font-heading text-[16px] font-semibold leading-[1.15]" style={{ color: current ? "#6B1F2E" : done ? "#466A53" : "#6E5F5B" }}>{passo.title}</div>
                  </div>
                  <span style={{ display: "inline-flex", padding: "3px 7px", borderRadius: 999, border: `1px solid ${tagStyle.border}`, background: tagStyle.background, color: tagStyle.color, fontSize: 8, fontWeight: 600, whiteSpace: "nowrap" }}>{tag}</span>
                </div>
                <div className="pt-1 text-[9.8px] font-light leading-[1.48] text-[#8A7B77]">{passo.description}</div>
              </div>
            </div>
          );
        })}
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
