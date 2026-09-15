interface CardMotivacionalProps {
  procedimento: string | null;
  quantidadeParcelas: number | null;
  percentualPago: number;
}

export function CardMotivacional({ procedimento, quantidadeParcelas, percentualPago }: CardMotivacionalProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : "Plano";
  const percentual = Math.max(0, Math.min(100, Math.round(percentualPago)));

  return (
    <section className="sl-dream-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="sl-eyebrow">Seu sonho está em movimento</div>
          <div className="sl-dream-title">{procedimento ?? "Seu procedimento"}</div>
          <div className="sl-dream-copy">
            Cada parcela confirmada aproxima você da sua conquista. Continue firme — sua jornada já começou e estamos com você em cada etapa.
          </div>
        </div>
        <div className="sl-plan-chip">{planoLabel}</div>
      </div>

      <div className="sl-plan-note">
        <span className="sl-plan-note-icon">
          <svg width="12" height="12" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2.8 10.9 6.6l4.2.6-3.05 2.97.72 4.17L9 12.38 5.23 14.34l.72-4.17L2.9 7.2l4.2-.6L9 2.8Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="sl-plan-note-title">Seu plano continua ativo</div>
          <div className="sl-plan-note-copy">Mantenha seus pagamentos em dia para avançar com tranquilidade até a liberação da sua agenda.</div>
        </div>
      </div>

      <div className="sl-separator" />
      <div className="sl-progress" aria-label={`${percentual}% das parcelas pagas`}>
        <div className="sl-progress-fill" style={{ width: `${percentual}%` }} />
      </div>
    </section>
  );
}
