import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deriveJourneySteps, type JourneyStepsInput } from "@/lib/journeySteps";
import type { NotificacaoCliente } from "@/lib/clientNotifications";

interface JornadaTabProps extends JourneyStepsInput {
  notificacoesCompactas: NotificacaoCliente[];
  onVerNotificacoes: () => void;
}

export function JornadaTab(props: JornadaTabProps) {
  const { notificacoesCompactas, onVerNotificacoes, ...journeyInput } = props;
  const passos = deriveJourneySteps(journeyInput);
  const compactas = notificacoesCompactas.slice(0, 3);

  return (
    <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 flex items-center justify-between px-0.5">
        <div>
          <h1 className="font-heading text-xl font-semibold text-burgundy">Sua jornada</h1>
          <p className="mt-0.5 text-[0.75rem] text-clay/55">Do contrato à sua cirurgia, passo a passo.</p>
        </div>
      </div>

      <section className="mb-5 rounded-[20px] border border-rose/12 bg-white/85 p-4 shadow-card">
        <div className="flex items-center justify-between">
          <p className="text-[0.6rem] font-bold uppercase tracking-label text-rose">Atualizações</p>
          <button type="button" onClick={onVerNotificacoes} className="text-[0.65rem] font-semibold text-burgundy hover:underline">
            Ver todas
          </button>
        </div>
        {compactas.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-clay/50">Nenhuma atualização nova no momento.</p>
        ) : (
          <ul className="mt-2.5 space-y-2">
            {compactas.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5">
                <span className={cn("mt-1.5 h-1.5 w-1.5 flex-none rounded-full", item.lida ? "bg-clay/20" : "bg-alert")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.78rem] font-semibold text-clay">{item.titulo}</p>
                  <p className="truncate text-[0.68rem] text-clay/50">{item.mensagem}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[20px] border border-rose/12 bg-white/85 p-4 shadow-card">
        <p className="text-[0.6rem] font-bold uppercase tracking-label text-rose">Passo a passo</p>
        <h2 className="mt-0.5 font-heading text-sm font-semibold text-burgundy">Do contrato à sua cirurgia</h2>

        <ol className="mt-4 space-y-0">
          {passos.map((passo, indice) => (
            <li key={passo.numero} className="relative flex gap-3 pb-5 last:pb-0">
              {indice < passos.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[13px] top-7 h-full w-px",
                    passo.status === "done" ? "bg-success/40" : "bg-clay/12",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 text-[0.65rem] font-bold",
                  passo.status === "done" && "border-success bg-success/10 text-success",
                  passo.status === "current" && "border-gold bg-gold/10 text-gold",
                  passo.status === "upcoming" && "border-clay/15 bg-transparent text-clay/35",
                )}
              >
                {passo.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : passo.numero}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[0.58rem] font-bold uppercase tracking-label text-clay/35">Etapa {passo.numero}</p>
                <p
                  className={cn(
                    "font-heading text-[0.85rem] font-semibold leading-tight",
                    passo.status === "upcoming" ? "text-clay/45" : "text-burgundy",
                  )}
                >
                  {passo.nome}
                </p>
                <p className="mt-0.5 text-[0.72rem] leading-relaxed text-clay/55">{passo.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-5 rounded-[20px] border border-rose/12 bg-blush/40 p-4 text-center">
        <p className="text-[0.8rem] leading-relaxed text-clay/65">Você não precisa decorar o processo.</p>
        <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-label text-burgundy">
          Sra. Luck · ao seu lado em cada etapa
        </p>
      </div>
    </div>
  );
}
