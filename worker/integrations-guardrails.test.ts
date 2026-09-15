import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTrustedMercadoPagoCheckoutUrl, safeMercadoPagoSnapshot } from "./integrations-core";

const integrationsCore = readFileSync(new URL("./integrations-core.ts", import.meta.url), "utf8");
const integrationsStatus = readFileSync(new URL("./integrations-status.ts", import.meta.url), "utf8");
const credenciais = readFileSync(new URL("./integrations-credenciais.ts", import.meta.url), "utf8");
const rdReadonly = readFileSync(new URL("./rd-station-readonly.ts", import.meta.url), "utf8");
const novasVendas = readFileSync(new URL("./admin-novas-vendas.ts", import.meta.url), "utf8");
const cirurgia = readFileSync(new URL("./admin-surgery-flow.ts", import.meta.url), "utf8");

describe("guardrails de integrações e regras críticas", () => {
  it("Mercado Pago não executa baixa automática de boleto", () => {
    expect(integrationsCore).not.toContain("financeiro_baixar_boleto");
    expect(integrationsCore).not.toContain("Pagamento automático via Mercado Pago");
    expect(integrationsCore).toContain("pagamentos_externos");
    expect(integrationsCore).toContain('status: "pendente_confirmacao"');
    expect(integrationsCore).toContain("baixaAutomatica: false");
  });

  it("checkout Mercado Pago só aceita HTTPS em domínio oficial", () => {
    expect(isTrustedMercadoPagoCheckoutUrl("https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=x")).toBe(true);
    expect(isTrustedMercadoPagoCheckoutUrl("https://mercadopago.com/checkout")).toBe(true);
    expect(isTrustedMercadoPagoCheckoutUrl("http://www.mercadopago.com.br/checkout")).toBe(false);
    expect(isTrustedMercadoPagoCheckoutUrl("https://mercadopago.com.br.evil.example/checkout")).toBe(false);
    expect(isTrustedMercadoPagoCheckoutUrl("javascript:alert(1)")).toBe(false);
  });

  it("snapshot Mercado Pago elimina PII e cartão", () => {
    const snapshot = safeMercadoPagoSnapshot({
      id: 123,
      status: "approved",
      transaction_amount: 99.9,
      external_reference: "boleto:abc",
      payment_method_id: "visa",
      metadata: { boleto_id: "abc", cliente_id: "cliente-secreto" },
      payer: { email: "cliente@example.com", identification: { number: "12345678900" } },
      card: { last_four_digits: "1234" },
    });
    const raw = JSON.stringify(snapshot);
    expect(raw).not.toContain("cliente@example.com");
    expect(raw).not.toContain("12345678900");
    expect(raw).not.toContain("cliente-secreto");
    expect(raw).not.toContain("last_four_digits");
    expect(snapshot.metadata).toEqual({ boleto_id: "abc" });
  });

  it("preferência usa rate limit de consumo, não contador de falha de login", () => {
    expect(integrationsCore).toContain('db.rpc("rate_limit_consumir"');
    expect(integrationsCore).not.toContain('login_registrar_falha", { p_chave: `mp-pref:');
  });

  it("cliente RD comercial é explicitamente GET-only", () => {
    expect(rdReadonly).toContain('const RD_CRM_BASE = "https://api.rd.services/crm/v2"');
    expect(rdReadonly).toContain('assertRdCommercialReadOnly("GET")');
    expect(rdReadonly).toContain('method: "GET"');
    expect(rdReadonly).toContain("RD_COMMERCIAL_WRITE_FORBIDDEN");
  });

  it("OAuth do RD é isolado do endpoint comercial", () => {
    expect(rdReadonly).toContain('const RD_OAUTH_TOKEN = "https://api.rd.services/oauth2/token"');
    expect(rdReadonly).toContain('grant_type: "authorization_code"');
    expect(rdReadonly).toContain('grant_type: "refresh_token"');
  });

  it("edições locais de venda não possuem saída HTTP para o RD", () => {
    expect(novasVendas).not.toContain("api.rd.services");
    expect(novasVendas).toContain("editou_venda_local_sem_sync_rd");
    expect(novasVendas).toContain("escritaNoRd: false");
  });

  it("status e histórico de integrações exigem admin ativo no próprio handler", () => {
    expect(integrationsStatus).toContain("exigirAdminAtivo");
    expect(integrationsStatus).toContain("verificarTokenAdmin");
    expect(integrationsStatus).toContain("buscarColaboradorAdminAtivo");
    expect(integrationsStatus).toContain("Acesso administrativo inativo ou não autorizado");
  });

  it("leitura e escrita de credenciais exigem permissão RBAC explícita", () => {
    expect(credenciais).toContain("INTEGRACOES_GERENCIAR_CREDENCIAIS");
    expect(credenciais).toContain("Seu papel não tem permissão para acessar credenciais de integrações");
  });

  it("referência mensal de orçamento apenas classifica a capacidade, sem bloquear", () => {
    expect(cirurgia).toContain('depois <= orcamentoMensal ? "verde" : "amarelo"');
    expect(cirurgia).toContain("ultrapassagem");
    expect(cirurgia).not.toContain("ORCAMENTO_MENSAL_EXCEDIDO");
  });
});
