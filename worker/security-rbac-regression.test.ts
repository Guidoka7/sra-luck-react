import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function worker(name: string) {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

const adminAuth = worker("admin-auth.ts");
const staff = worker("staff-api.ts");
const novasVendas = worker("admin-novas-vendas.ts");
const cirurgia = worker("admin-surgery-flow.ts");
const monitoramento = worker("monitoramento-erros.ts");
const notificacoes = worker("admin-notificacoes.ts");
const creditOps = worker("credit-ops.ts");
const rd = worker("rd-station-readonly.ts");
const integrations = worker("integrations-core.ts");

describe("regressões de segurança RBAC e borda HTTP", () => {
  it("centraliza as permissões sensíveis novas", () => {
    for (const key of [
      "EQUIPE_GERENCIAR",
      "CREDITO_GERENCIAR",
      "NOTIFICACOES_GERENCIAR",
      "MONITORAMENTO_VISUALIZAR",
      "RELATORIOS_VISUALIZAR",
      "INTEGRACOES_OPERAR_FINANCEIRO",
    ]) expect(adminAuth).toContain(key);
  });

  it("gestão de equipe exige RBAC e bloqueia escalada de privilégio", () => {
    expect(staff).toContain("PERMISSOES_ADMIN.EQUIPE_GERENCIAR");
    expect(staff).toContain("Somente o perfil administrativo pode criar acessos elevados.");
    expect(staff).toContain("Somente o perfil administrativo pode alterar cargo ou permissões.");
    expect(staff).toContain("MAX_TENTATIVAS_LOGIN_EQUIPE_IP");
    expect(staff).toContain("MAX_TENTATIVAS_LOGIN_EQUIPE_EMAIL");
  });

  it("staging do CRM não pode alterar cliente sem clientes.editar", () => {
    expect(novasVendas).toContain("PERMISSOES_ADMIN.CLIENTES_EDITAR");
    expect(novasVendas).toContain("Requisição de origem não autorizada.");
  });

  it("fluxo cirúrgico legado separa permissão financeira de agenda", () => {
    expect(cirurgia).toContain("PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL");
    expect(cirurgia).toContain("PERMISSOES_ADMIN.AGENDA_GERENCIAR");
    expect(cirurgia).not.toContain('usuario: "admin_worker"');
  });

  it("telemetria pública é limitada e monitoramento administrativo é restrito", () => {
    expect(monitoramento).toContain("PERMISSOES_ADMIN.MONITORAMENTO_VISUALIZAR");
    expect(monitoramento).toContain('rpc("rate_limit_consumir"');
    expect(monitoramento).toContain("p_max_tentativas: 60");
  });

  it("notificações e credit ops exigem permissões granulares", () => {
    expect(notificacoes).toContain("PERMISSOES_ADMIN.NOTIFICACOES_GERENCIAR");
    expect(notificacoes).toContain("PERMISSOES_ADMIN.FINANCEIRO_VALIDAR_COMPROVANTE");
    expect(creditOps).toContain("PERMISSOES_ADMIN.CREDITO_GERENCIAR");
    expect(creditOps).toContain("PERMISSOES_ADMIN.EQUIPE_GERENCIAR");
  });

  it("segredos de webhook não são aceitos pela URL e MP normaliza data.id", () => {
    expect(rd).not.toContain('searchParams.get("key")');
    expect(rd).toContain('request.headers.get("x-sra-luck-rd-key")');
    expect(integrations).toContain(').toLowerCase();');
    expect(integrations).toContain('contentLength > 512_000');
  });
});
