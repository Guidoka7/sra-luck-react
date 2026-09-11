import { requiredString, validateIsoDate, validateMoney } from "../validation.js";
import type {
  BancoProvider,
  ChargeRequest,
  ChargeResult,
  LeadInput,
  LeadResult,
  NormalizedWebhookEvent,
  PagamentoProvider,
  PaymentRequest,
  PaymentResult,
  ProviderContext,
  RDProvider,
} from "./types.js";
import { asJsonObject, readNumber, readString } from "./http.js";

function mockId(prefix: string, reference: string): string {
  const normalized = reference.replace(/[^a-z0-9]/gi, "").slice(-24) || crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}_${normalized}`;
}

function verifyMockRequest(request: Request): boolean {
  return request.headers.get("x-mock-webhook") === "1" || new URL(request.url).searchParams.get("mock") === "1";
}

export class MockBankProvider implements BancoProvider {
  readonly name = "mock" as const;
  isConfigured(): boolean { return true; }

  async createCharge(input: ChargeRequest, _context: ProviderContext): Promise<ChargeResult> {
    requiredString(input.reference, "referência", 160);
    validateMoney(input.amount, "valor");
    validateIsoDate(input.dueDate, "vencimento");
    return {
      provider: this.name,
      externalId: mockId("bank", input.reference),
      status: "created",
      amount: input.amount,
      dueDate: input.dueDate,
      barcode: "00190000000000000000000000000000000000000000",
      digitableLine: "00190.00000 00000.000000 00000.000000 0 00000000000000",
      paymentUrl: "https://example.invalid/mock-bank-charge",
      raw: { mock: true, reference: input.reference },
    };
  }

  async getCharge(externalId: string, _context: ProviderContext): Promise<ChargeResult> {
    const id = requiredString(externalId, "identificador", 200);
    return { provider: this.name, externalId: id, status: "paid", amount: 100, dueDate: null, barcode: null, digitableLine: null, paymentUrl: null, raw: { mock: true } };
  }

  async verifyWebhook(request: Request): Promise<boolean> { return verifyMockRequest(request); }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    return {
      provider: this.name,
      eventId: readString(data, "eventId", "id") ?? request.headers.get("x-event-id") ?? crypto.randomUUID(),
      type: "payment_settled",
      resourceId: readString(data, "resourceId", "chargeId"),
      reference: readString(data, "reference"),
      amount: readNumber(data, "amount"),
      occurredAt: new Date().toISOString(),
      status: "paid",
      raw: data,
    };
  }
}

export class MockRDProvider implements RDProvider {
  readonly name = "mock" as const;
  isConfigured(): boolean { return true; }

  async upsertLead(input: LeadInput, _context: ProviderContext): Promise<LeadResult> {
    const name = requiredString(input.name, "nome", 200);
    return { provider: this.name, externalId: mockId("rd", input.externalId ?? name), status: "synced", raw: { mock: true, name } };
  }

  async verifyWebhook(request: Request): Promise<boolean> { return verifyMockRequest(request); }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    return {
      provider: this.name,
      eventId: readString(data, "eventId", "id") ?? request.headers.get("x-event-id") ?? crypto.randomUUID(),
      type: "deal_won",
      resourceId: readString(data, "leadId", "resourceId"),
      reference: readString(data, "reference", "dealId"),
      amount: readNumber(data, "amount", "value"),
      occurredAt: new Date().toISOString(),
      status: "won",
      raw: data,
    };
  }
}

export class MockPaymentProvider implements PagamentoProvider {
  readonly name = "mock" as const;
  isConfigured(): boolean { return true; }

  async createPayment(input: PaymentRequest, _context: ProviderContext): Promise<PaymentResult> {
    requiredString(input.reference, "referência", 160);
    validateMoney(input.amount, "valor");
    return {
      provider: this.name,
      externalId: mockId("pay", input.reference),
      status: "created",
      checkoutUrl: "https://example.invalid/mock-checkout",
      raw: { mock: true, reference: input.reference, amount: input.amount },
    };
  }

  async getPayment(externalId: string, _context: ProviderContext): Promise<PaymentResult> {
    const id = requiredString(externalId, "identificador", 200);
    return { provider: this.name, externalId: id, status: "approved", checkoutUrl: null, raw: { mock: true } };
  }

  async verifyWebhook(request: Request): Promise<boolean> { return verifyMockRequest(request); }

  async normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent> {
    const data = asJsonObject(payload);
    return {
      provider: this.name,
      eventId: readString(data, "eventId", "id") ?? request.headers.get("x-event-id") ?? crypto.randomUUID(),
      type: "payment_settled",
      resourceId: readString(data, "paymentId", "resourceId"),
      reference: readString(data, "reference"),
      amount: readNumber(data, "amount"),
      occurredAt: new Date().toISOString(),
      status: "approved",
      raw: data,
    };
  }
}
