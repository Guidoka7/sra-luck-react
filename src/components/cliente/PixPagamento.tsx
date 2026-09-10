"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, QrCode, Check, Sparkles } from "lucide-react";
import { formatarMoeda } from "@/lib/utils";

interface DescontoPix {
  percentual: number;
  economia: number;
  valorComDesconto: number;
}

interface PixPagamentoProps {
  pixChave: string | null;
  pixQrCodeUrl: string | null;
  desconto?: DescontoPix | null;
}

export function PixPagamento({ pixChave, pixQrCodeUrl, desconto }: PixPagamentoProps) {
  const [copiado, setCopiado] = useState(false);
  if (!pixChave && !pixQrCodeUrl) return null;

  async function copiarChave() {
    if (!pixChave) return;
    try {
      await navigator.clipboard.writeText(pixChave);
      setCopiado(true);
      toast.success("Chave PIX copiada! 💛");
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      toast.error("Não foi possível copiar a chave PIX.");
    }
  }

  const temDesconto = !!desconto && desconto.percentual > 0;

  return (
    <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-blush/35 via-white to-cream p-3.5 shadow-soft sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">Pagamento via PIX</p>
          {temDesconto ? (
            <p className="mt-1 text-xs font-medium text-success">
              {desconto!.percentual}% de desconto nos encargos · economize {formatarMoeda(desconto!.economia)}
            </p>
          ) : (
            <p className="mt-1 text-xs text-clay/55">Pague o valor indicado e depois anexe o comprovante.</p>
          )}
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/10"><QrCode className="h-4 w-4 text-gold" /></span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        {pixQrCodeUrl && (
          <img src={pixQrCodeUrl} alt="QR Code PIX" className="h-24 w-24 flex-none rounded-xl border border-rose/15 bg-white object-contain p-1.5 shadow-sm" />
        )}
        <div className="min-w-0 flex-1">
          {pixChave && (
            <button onClick={copiarChave} className="flex w-full items-center justify-between gap-2 rounded-xl border border-rose/15 bg-white px-3 py-2.5 text-left text-xs font-medium text-burgundy shadow-sm transition hover:border-gold/40">
              <span className="min-w-0 truncate">{pixChave}</span>
              {copiado ? <Check className="h-4 w-4 flex-none text-success" /> : <Copy className="h-4 w-4 flex-none text-rose" />}
            </button>
          )}
          {temDesconto && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-clay/55">
              <Sparkles className="h-3 w-3 text-success" />
              Total para pagar hoje: <strong className="text-burgundy">{formatarMoeda(desconto!.valorComDesconto)}</strong>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-[10px] text-clay/40">Pagamento direto na conta informada pela Sra. Luck.</p>
    </div>
  );
}
