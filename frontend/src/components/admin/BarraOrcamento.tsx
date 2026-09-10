"use client";

import { formatarMoeda } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function BarraOrcamento({
  valorAtual,
  meta,
  label = "Crédito liberado no mês",
}: {
  valorAtual: number;
  meta: number;
  label?: string;
}) {
  const percentual = meta > 0 ? Math.min((valorAtual / meta) * 100, 100) : 0;
  const excedido = valorAtual > meta;

  return (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-label text-rose">{label}</p>
          <p
            className={cn(
              "text-3xl font-semibold",
              excedido ? "text-alert" : "text-burgundy"
            )}
          >
            {formatarMoeda(valorAtual)}
          </p>
        </div>
        <p className="text-sm text-clay/50">meta {formatarMoeda(meta)}</p>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-blush">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            excedido ? "bg-alert" : "bg-gradient-to-r from-rose to-burgundy"
          )}
          style={{ width: `${percentual}%` }}
        />
      </div>
      {excedido && (
        <p className="mt-2 text-xs text-alert">
          O orçamento deste mês ultrapassou a meta prevista.
        </p>
      )}
    </div>
  );
}
