import type { Env } from "../supabase.js";
import type { StructuredLogger } from "../middleware/logger.js";
import type { BancoProvider, BankProviderName, PagamentoProvider, PaymentProviderName, RDProvider } from "./types.js";
import { createBankProvider } from "./banco.provider.js";
import { createRDProvider } from "./rd.provider.js";
import { createContaAzulProvider, createMercadoPagoProvider } from "./pagamento.provider.js";
import { MockBankProvider, MockPaymentProvider, MockRDProvider } from "./mock.provider.js";

export class ProviderFactory {
  constructor(private readonly env: Env, private readonly logger: StructuredLogger) {}

  get mode(): "mock" | "live" {
    return this.env.INTEGRATION_MODE === "live" ? "live" : "mock";
  }

  bank(name: BankProviderName): BancoProvider {
    if (this.mode === "mock") return new MockBankProvider();
    return createBankProvider(name, this.env, this.logger);
  }

  rd(): RDProvider {
    if (this.mode === "mock") return new MockRDProvider();
    return createRDProvider(this.env, this.logger);
  }

  payment(name: PaymentProviderName): PagamentoProvider {
    if (this.mode === "mock") return new MockPaymentProvider();
    return name === "conta_azul"
      ? createContaAzulProvider(this.env, this.logger)
      : createMercadoPagoProvider(this.env, this.logger);
  }

  summary(): Record<string, boolean | string> {
    const banks: BankProviderName[] = ["brb", "bb", "santander", "sicredi", "efi"];
    return {
      mode: this.mode,
      rd_station: this.rd().isConfigured(),
      mercado_pago: this.payment("mercado_pago").isConfigured(),
      conta_azul: this.payment("conta_azul").isConfigured(),
      ...Object.fromEntries(banks.map((name) => [`bank_${name}`, this.bank(name).isConfigured()])),
    };
  }
}
