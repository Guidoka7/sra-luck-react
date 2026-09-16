interface CardMotivacionalProps {
  procedimento: string | null;
  quantidadeParcelas: number | null;
  percentualPago: number;
}

export function CardMotivacional({ procedimento, quantidadeParcelas, percentualPago }: CardMotivacionalProps) {
  const planoLabel = quantidadeParcelas ? `Plano ${quantidadeParcelas}x` : "Seu plano";
  const percentual = Math.max(0, Math.min(100, Math.round(percentualPago)));

  return (
    <section className="sl-dream-card" style={{ padding: "15px 16px" }}>
      <div className="min-w-0">
        <div className="sl-eyebrow">Um passo de cada vez</div>
        <div className="sl-dream-title" style={{ fontSize: "24px", paddingTop: "2px" }}>
          {procedimento ?? "Seu procedimento"}
        </div>
        <div className="sl-dream-copy" style={{ paddingTop: "5px", fontSize: "11.2px" }}>
          Você já começou. Cada pagamento confirmado aproxima você da sua conquista.
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="sl-plan-chip" style={{ padding: "4px 9px", fontSize: "10.5px" }}>{planoLabel}</div>
        <span className="text-[10.5px] font-semibold text-[#8E6D67]">{percentual}% concluído</span>
      </div>

      <div className="mt-2 sl-progress" style={{ height: "6px" }} aria-label={`${percentual}% das parcelas pagas`}>
        <div className="sl-progress-fill" style={{ width: `${percentual}%` }} />
      </div>
    </section>
  );
}
