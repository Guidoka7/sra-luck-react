import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const integrationsCore = readFileSync(new URL("./integrations-core.ts", import.meta.url), "utf8");
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

  it("referência mensal de orçamento apenas classifica a capacidade, sem bloquear", () => {
    expect(cirurgia).toContain('depois <= orcamentoMensal ? "verde" : "amarelo"');
    expect(cirurgia).toContain("ultrapassagem");
    expect(cirurgia).not.toContain("ORCAMENTO_MENSAL_EXCEDIDO");
  });
});
