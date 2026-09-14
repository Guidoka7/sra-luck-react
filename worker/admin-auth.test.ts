import { describe, expect, it } from "vitest";
import { PERMISSOES_ADMIN, temPermissaoAdmin, type ColaboradorAdmin } from "./admin-auth";

function colaborador(overrides: Partial<ColaboradorAdmin> = {}): ColaboradorAdmin {
  return { id: "c1", auth_user_id: "u1", cargo: "financeiro", ativo: true, permissoes: [], ...overrides };
}

describe("temPermissaoAdmin (Fase 8 — RBAC)", () => {
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
