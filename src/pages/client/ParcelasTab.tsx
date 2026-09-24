import { useCallback, useEffect, useState } from "react";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { PagamentoProgressBar } from "@/components/cliente/parcelas/PagamentoProgressBar";
import { ParcelasPrototype, type PagamentoConfig } from "@/components/cliente/parcelas/ParcelasPrototype";

interface ParcelasTabProps {
  procedimento: string | null;
}

export function ParcelasTab({ procedimento }: ParcelasTabProps) {
  const [pagamento, setPagamento] = useState<PagamentoConfig | undefined>(undefined);
  // Subtítulo acompanha a situação das parcelas (atraso, vencimento próximo, em dia).
  const [resumo, setResumo] = useState("Seu contrato em uma única visão, do pagamento confirmado ao próximo vencimento.");
  const aoResumir = useCallback((texto: string) => setResumo(texto), []);

  useEffect(() => {
    fetch("/api/cliente/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => {
        if (dados) setPagamento({ pixChave: dados.pixChave ?? null, pixQrCodeUrl: dados.pixQrCodeUrl ?? null, pixDescontoPercentual: dados.pixDescontoPercentual ?? 0, cartaoDisponivel: dados.cartaoDisponivel === true });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="sl-tab">
      <div className="sl-tab-logo"><MarcaSraLuck /></div>
      <div className="sl-tab-heading">
        <h1>Financeiro</h1>
        <p>{resumo}</p>
      </div>
      <PagamentoProgressBar procedimento={procedimento} />
      <ParcelasPrototype pagamento={pagamento} onResumo={aoResumir} />
    </div>
  );
}
