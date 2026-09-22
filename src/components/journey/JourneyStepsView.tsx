import { Check } from "lucide-react";
import type { JourneyStep } from "@/lib/journeySteps";

/**
 * Representação única das etapas da Jornada (mesma lista de
 * `deriveJourneySteps`). `app` é a timeline do app da cliente; `compact` é a
 * versão acordeão do drawer administrativo (V46). Mesmas etapas, nomes,
 * descrições e estados — só a densidade muda.
 */
export function JourneyStepsView({ passos, variant }: { passos: JourneyStep[]; variant: "app" | "compact" }) {
  if (variant === "compact") {
    return <div className="journey-list">
      {passos.map((passo, i) => {
        const done = passo.status === "done";
        const current = passo.status === "current";
        return <details key={passo.id} className={`journey-step ${done ? "done" : current ? "current" : "upcoming"}`} open={current || undefined}>
          <summary>
            <span className="journey-dot" aria-hidden="true">{done ? "✓" : i + 1}</span>
            <span className="journey-summary-copy"><b>{passo.title}</b><small>{done ? "Concluída" : current ? "Etapa atual" : "Bloqueada"}</small></span>
            <span className="journey-chevron" aria-hidden="true">⌄</span>
          </summary>
          <p>{passo.description}</p>
        </details>;
      })}
    </div>;
  }

  return <>
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
  </>;
}
