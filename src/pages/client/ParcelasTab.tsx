import { useCallback, useState } from "react";
import { MarcaSraLuck } from "@/components/cliente/MarcaSraLuck";
import { PagamentoProgressBar } from "@/components/cliente/parcelas/PagamentoProgressBar";
import { ParcelasPrototype, type PagamentoConfig } from "@/components/cliente/parcelas/ParcelasPrototype";
import type { BoletosData } from "@/lib/clienteAgenda";

interface ParcelasTabProps {
  procedimento: string | null;
  boletos: BoletosData;
  pagamento?: PagamentoConfig;
  onAtualizar: () => Promise<void>;
}

export function ParcelasTab({ procedimento, boletos, pagamento, onAtualizar }: ParcelasTabProps) {
  // Subtítulo acompanha a situação das parcelas (atraso, vencimento próximo, em dia).
  const [resumo, setResumo] = useState("Seu contrato em uma única visão, do pagamento confirmado ao próximo vencimento.");
  const aoResumir = useCallback((texto: string) => setResumo(texto), []);

  return (
    <div className="sl-tab">
      <div className="sl-tab-logo"><MarcaSraLuck /></div>
      <div className="sl-tab-heading">
        <h1>Financeiro</h1>
        <p>{resumo}</p>
      </div>
      <PagamentoProgressBar procedimento={procedimento} progresso={boletos} />
      <ParcelasPrototype pagamento={pagamento} dados={boletos} onAtualizar={onAtualizar} onResumo={aoResumir} />
    </div>
  );
}
