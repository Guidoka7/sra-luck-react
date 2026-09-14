import { TabBoletos } from "@/components/cliente/TabBoletos";
import { ComprovantesClienteActions } from "@/components/cliente/ComprovantesClienteActions";
import type { CardPaymentConfig } from "@/lib/cardPayment";

interface ParcelasTabProps {
  procedimento: string | null;
  pagamento?: { pixChave: string | null; pixQrCodeUrl: string | null; pixDescontoPercentual?: number };
  cartao?: CardPaymentConfig;
}

export function ParcelasTab({ procedimento, pagamento, cartao }: ParcelasTabProps) {
  return (
    <div className="pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 px-0.5">
        <h1 className="font-heading text-xl font-semibold text-burgundy">Minhas parcelas</h1>
        <p className="mt-0.5 text-[0.75rem] text-clay/55">Acompanhe pagamentos, comprovantes e formas de pagamento.</p>
      </div>
      <TabBoletos procedimento={procedimento} pagamento={pagamento} cartao={cartao} />
      <ComprovantesClienteActions />
    </div>
  );
}
