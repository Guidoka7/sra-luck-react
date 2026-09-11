export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type BankProviderName = "brb" | "bb" | "santander" | "sicredi" | "efi";
export type PaymentProviderName = "mercado_pago" | "conta_azul";
export type ProviderName = BankProviderName | PaymentProviderName | "rd_station" | "mock";

export interface ProviderContext {
  requestId: string;
  actorType?: string;
  actorId?: string;
}

export interface ChargeCustomer {
  name: string;
  document: string;
  email?: string | null;
  phone?: string | null;
}

export interface ChargeRequest {
  reference: string;
  amount: number;
  dueDate: string;
  description: string;
  customer: ChargeCustomer;
  metadata?: JsonObject;
}

export interface ChargeResult {
  provider: ProviderName;
  externalId: string;
  status: string;
  amount: number;
  dueDate?: string | null;
  barcode?: string | null;
  digitableLine?: string | null;
  paymentUrl?: string | null;
  raw: JsonObject;
}

export interface LeadInput {
  externalId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
  campaign?: string | null;
  source?: string | null;
  value?: number | null;
  metadata?: JsonObject;
}

export interface LeadResult {
  provider: "rd_station" | "mock";
  externalId: string;
  status: string;
  raw: JsonObject;
}

export interface PaymentRequest {
  reference: string;
  amount: number;
  description: string;
  payer: ChargeCustomer;
  successUrl?: string | null;
  pendingUrl?: string | null;
  failureUrl?: string | null;
  notificationUrl?: string | null;
  metadata?: JsonObject;
}

export interface PaymentResult {
  provider: PaymentProviderName | "mock";
  externalId: string;
  status: string;
  checkoutUrl?: string | null;
  raw: JsonObject;
}

export type NormalizedEventType =
  | "charge_created"
  | "charge_updated"
  | "payment_pending"
  | "payment_settled"
  | "payment_failed"
  | "lead_created"
  | "lead_updated"
  | "deal_won"
  | "unknown";

export interface NormalizedWebhookEvent {
  provider: ProviderName;
  eventId: string;
  type: NormalizedEventType;
  resourceId?: string | null;
  reference?: string | null;
  amount?: number | null;
  occurredAt?: string | null;
  status?: string | null;
  raw: JsonObject;
}

export interface BancoProvider {
  readonly name: BankProviderName | "mock";
  isConfigured(): boolean;
  createCharge(input: ChargeRequest, context: ProviderContext): Promise<ChargeResult>;
  getCharge(externalId: string, context: ProviderContext): Promise<ChargeResult>;
  verifyWebhook(request: Request): Promise<boolean>;
  normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent>;
}

export interface RDProvider {
  readonly name: "rd_station" | "mock";
  isConfigured(): boolean;
  upsertLead(input: LeadInput, context: ProviderContext): Promise<LeadResult>;
  verifyWebhook(request: Request): Promise<boolean>;
  normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent>;
}

export interface PagamentoProvider {
  readonly name: PaymentProviderName | "mock";
  isConfigured(): boolean;
  createPayment(input: PaymentRequest, context: ProviderContext): Promise<PaymentResult>;
  getPayment(externalId: string, context: ProviderContext): Promise<PaymentResult>;
  verifyWebhook(request: Request): Promise<boolean>;
  normalizeWebhook(payload: unknown, request: Request): Promise<NormalizedWebhookEvent>;
}
