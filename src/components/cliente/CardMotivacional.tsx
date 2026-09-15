import { Sparkles } from "lucide-react";

interface CardMotivacionalProps {
  procedimento: string | null;
  quantidadeParcelas: number | null;
  percentualPago: number;
}

export function CardMotivacional({ procedimento, quantidadeParcelas, percentualPago }: CardMotivacionalProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : null;
  const percentual = Math.max(0, Math.min(100, Math.round(percentualPago)));

  return (
    <div className="relative overflow-hidden rounded-[22px] border border-gold/20 bg-gradient-to-br from-white via-blush/35 to-white p-4 shadow-card sm:p-5">
      <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gold/10 blur-2xl" />

      <p className="relative flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-label text-gold">
        <Sparkles className="h-3 w-3" /> Seu sonho está em movimento
      </p>

      <div className="relative mt-1.5 flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-lg font-semibold leading-tight text-burgundy">
          {procedimento ?? "Seu procedimento"}
        </h2>
        {planoLabel && (
          <span className="rounded-full bg-burgundy/8 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-label text-burgundy">
            {planoLabel}
          </span>
        )}
      </div>

      <p className="relative mt-2 text-[0.78rem] leading-relaxed text-clay/70">
        Cada parcela confirmada aproxima você da sua conquista. Continue firme — sua jornada já começou e estamos com
        você em cada etapa.
      </p>

      <div className="relative mt-3.5">
        <div className="flex items-center justify-between text-[0.6rem] font-semibold uppercase tracking-label text-clay/45">
          <span>Seu plano continua ativo</span>
          <span className="text-burgundy">{percentual}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-clay/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-burgundy to-rose transition-[width] duration-700"
            style={{ width: `${percentual}%` }}
          />
        </div>
      </div>
    </div>
  );
}
