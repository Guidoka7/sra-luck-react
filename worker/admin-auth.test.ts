import { describe, expect, it } from "vitest";
import { PERMISSOES_ADMIN, permissaoObrigatoriaParaRota, temPermissaoAdmin, type ColaboradorAdmin } from "./admin-auth";

function colaborador(overrides: Partial<ColaboradorAdmin> = {}): ColaboradorAdmin {
  return { id: "c1", auth_user_id: "u1", cargo: "financeiro", ativo: true, permissoes: [], ...overrides };
}

function req(path: string, method = "GET") {
  return new Request(`https://app.example${path}`, { method });
}

describe("temPermissaoAdmin (RBAC)", () => {
  it("administrativo sempre tem acesso, mesmo sem a permissão explícita", () => {
    const admin = colaborador({ cargo: "administrativo", permissoes: [] });
    expect(temPermissaoAdmin(admin, PERMISSOES_ADMIN.CLIENTES_EXCLUIR)).toBe(true);
  });

  it("financeiro sem a permissão explícita não pode excluir cliente", () => {
    const financeiro = colaborador({ cargo: "financeiro", permissoes: [] });
    expect(temPermissaoAdmin(financeiro, PERMISSOES_ADMIN.CLIENTES_EXCLUIR)).toBe(false);
  });

  it("financeiro com a permissão explícita concedida pode executar a ação", () => {
    const financeiro = colaborador({ cargo: "financeiro", permissoes: [PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL] });
    expect(temPermissaoAdmin(financeiro, PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL)).toBe(true);
    expect(temPermissaoAdmin(financeiro, PERMISSOES_ADMIN.CLIENTES_EXCLUIR)).toBe(false);
  });

  it("gestao segue a mesma regra granular que financeiro", () => {
    const gestao = colaborador({ cargo: "gestao", permissoes: [PERMISSOES_ADMIN.EQUIPE_GERENCIAR] });
    expect(temPermissaoAdmin(gestao, PERMISSOES_ADMIN.EQUIPE_GERENCIAR)).toBe(true);
    expect(temPermissaoAdmin(gestao, PERMISSOES_ADMIN.INTEGRACOES_GERENCIAR_CREDENCIAIS)).toBe(false);
  });
});

describe("RBAC global por rota", () => {
  it("não exige permissão extra em leituras", () => {
    expect(permissaoObrigatoriaParaRota(req("/api/admin/clientes"))).toBeNull();
    expect(permissaoObrigatoriaParaRota(req("/api/admin/boletos"))).toBeNull();
  });

  it("protege edição e exclusão de clientes", () => {
    expect(permissaoObrigatoriaParaRota(req("/api/admin/clientes/x", "PATCH"))).toBe(PERMISSOES_ADMIN.CLIENTES_EDITAR);
    expect(permissaoObrigatoriaParaRota(req("/api/admin/clientes/x", "DELETE"))).toBe(PERMISSOES_ADMIN.CLIENTES_EXCLUIR);
    expect(permissaoObrigatoriaParaRota(req("/api/admin/clientes/x/status-contrato", "POST"))).toBe(PERMISSOES_ADMIN.CLIENTES_ALTERAR_STATUS_CONTRATO);
  });

  it("protege mutações financeiras, agenda e configurações", () => {
    expect(permissaoObrigatoriaParaRota(req("/api/admin/clientes/x/parcelas", "POST"))).toBe(PERMISSOES_ADMIN.FINANCEIRO_GERENCIAR_PLANO);
    expect(permissaoObrigatoriaParaRota(req("/api/admin/boletos/x", "PATCH"))).toBe(PERMISSOES_ADMIN.FINANCEIRO_BAIXA_MANUAL);
    expect(permissaoObrigatoriaParaRota(req("/api/admin/datas", "POST"))).toBe(PERMISSOES_ADMIN.AGENDA_GERENCIAR);
    expect(permissaoObrigatoriaParaRota(req("/api/admin/configuracoes", "PATCH"))).toBe(PERMISSOES_ADMIN.CONFIGURACOES_GERENCIAR);
  });
});
