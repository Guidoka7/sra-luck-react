import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

describe("Conta Azul: o Sra Luck não escreve no financeiro da Conta Azul", () => {
  const contaAzul = readFileSync(new URL("./conta-azul.ts", import.meta.url), "utf8");
  const vinculos = readFileSync(new URL("./conta-azul-vinculos.ts", import.meta.url), "utf8");
  const adminFinanceiro = readFileSync(new URL("./admin-financeiro.ts", import.meta.url), "utf8");
  const chamadas = (fonte: string) => [...fonte.matchAll(/caRequest(?:ComCabecalhos)?\(\s*d\s*,\s*"(GET|POST|PATCH|DELETE|PUT)"\s*,\s*([^,)]+)/g)].map((m) => [m[1], m[2].trim()]);

  it("toda chamada à API é GET, exceto revogar a conexão OAuth", () => {
    const escritas = [...chamadas(contaAzul), ...chamadas(vinculos)].filter(([metodo]) => metodo !== "GET");
    expect(escritas).toEqual([["DELETE", expect.stringContaining("/oauth/connections/")]]);
  });

  it("nenhum endpoint de escrita financeira aparece no código da integração", () => {
    // O cliente HTTP só aceita GET e DELETE, e o DELETE só em /oauth/connections/{id}.
    expect(contaAzul).toContain('type MetodoPermitido = "GET" | "DELETE";');
    expect(contaAzul).toContain('throw new ErroContaAzul("escrita_bloqueada"');
    for (const fonte of [contaAzul, vinculos]) {
      expect(fonte).not.toMatch(/caRequest(ComCabecalhos)?\(\s*d\s*,\s*"(POST|PATCH|PUT)"/);
      expect(fonte).not.toMatch(/parcelas\/baixa\//);
      expect(fonte).not.toMatch(/\/baixa`/);
      expect(fonte).not.toMatch(/gerar-cobranca|contas-a-receber"|contas-a-receber`,/);
    }
  });

  it("o Admin bloqueia baixa manual e confirmação de comprovante em parcela vinculada", () => {
    expect(adminFinanceiro.match(/parcelaControladaPelaContaAzul\(/g)?.length).toBe(2);
    expect(adminFinanceiro).toContain('codigo: "PAGAMENTO_CONTA_AZUL"');
  });
});
