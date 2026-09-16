interface CardMotivacionalProps {
  procedimento: string | null;
  quantidadeParcelas: number | null;
  percentualPago: number;
}

export function CardMotivacional({ procedimento, quantidadeParcelas, percentualPago }: CardMotivacionalProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : "Seu plano";
  const percentual = Math.max(0, Math.min(100, Math.round(percentualPago)));

  return (
    <section className="sl-dream-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="sl-eyebrow">Sua conquista está mais perto</div>
          <div className="sl-dream-title">{procedimento ?? "Seu procedimento"}</div>
          <div className="sl-dream-copy">
            Cada parcela confirmada é mais um passo. Continue firme — sua jornada já está em movimento.
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="sl-plan-chip">{planoLabel}</div>
        <span className="text-[11px] font-semibold text-[#8E6D67]">{percentual}% concluído</span>
      </div>

      <div className="mt-2.5 sl-progress" aria-label={`${percentual}% das parcelas pagas`}>
        <div className="sl-progress-fill" style={{ width: `${percentual}%` }} />
      </div>
    </section>
  );
}
