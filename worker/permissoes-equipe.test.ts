import { describe, expect, it } from "vitest";
import { type ColaboradorAdmin } from "./admin-auth";
import { adminReadPermissions, adminWritePermissions, canReadAdminRoute, canWriteAdminRoute } from "./admin-route-permissions";
import { ABAS_PERMISSOES, MODELOS_CARGO, PERMISSOES_VALIDAS, temAcessoAoPainel, TODAS_PERMISSOES } from "../src/lib/permissoesEquipe";

const pessoa = (cargo: ColaboradorAdmin["cargo"], permissoes: string[]): ColaboradorAdmin => ({ id: "x", auth_user_id: "x", cargo, ativo: true, permissoes });

describe("catálogo de permissões da equipe", () => {
  it("chaves únicas, todas as abas com ao menos uma permissão", () => {
    expect(new Set(TODAS_PERMISSOES).size).toBe(TODAS_PERMISSOES.length);
    for (const aba of ABAS_PERMISSOES) expect(aba.permissoes.length).toBeGreaterThan(0);
    expect(TODAS_PERMISSOES).not.toContain("integracoes.gerenciar_credenciais");
    expect(TODAS_PERMISSOES).not.toContain("monitoramento.visualizar");
  });

  it("modelos só usam permissões do catálogo", () => {
    for (const modelo of Object.values(MODELOS_CARGO)) for (const p of modelo.permissoes) expect(PERMISSOES_VALIDAS.has(p), p).toBe(true);
  });

  it("entra no painel quem é Administrativo ou tem ao menos uma permissão", () => {
    expect(temAcessoAoPainel("administrativo", [])).toBe(true);
    expect(temAcessoAoPainel("vendedora", [])).toBe(false);
    expect(temAcessoAoPainel("vendedora", ["clientes.ver"])).toBe(true);
    expect(temAcessoAoPainel("financeiro", ["monitoramento.visualizar"])).toBe(false);
  });
});

describe("leitura e escrita por aba", () => {
  it("'ver' dá leitura mas não escrita", () => {
    const leitora = pessoa("vendedora", ["clientes.ver"]);
    expect(canReadAdminRoute(leitora, "/api/admin/clientes")).toBe(true);
    expect(canWriteAdminRoute(leitora, "/api/admin/clientes")).toBe(false);
    expect(canWriteAdminRoute(pessoa("vendedora", ["clientes.editar"]), "/api/admin/clientes")).toBe(true);
  });

  it("vendedora sem financeiro não lê nem escreve no Financeiro", () => {
    const vendedora = pessoa("vendedora", MODELOS_CARGO.vendedora.permissoes);
    expect(canReadAdminRoute(vendedora, "/api/admin/financeiro/clientes")).toBe(false);
    expect(canWriteAdminRoute(vendedora, "/api/admin/boletos/x/baixa")).toBe(false);
    expect(canReadAdminRoute(vendedora, "/api/admin/integrations/rd-station/importacoes")).toBe(true);
    expect(canReadAdminRoute(vendedora, "/api/admin/visao-geral")).toBe(false);
  });

  it("financeiro opera a Conta Azul e as parcelas, mas não a equipe nem as configurações", () => {
    const fin = pessoa("financeiro", MODELOS_CARGO.financeiro.permissoes);
    expect(canWriteAdminRoute(fin, "/api/admin/integrations/conta-azul/sincronizar")).toBe(true);
    expect(canWriteAdminRoute(fin, "/api/admin/financeiro/clientes/x/parcelas")).toBe(true);
    expect(canReadAdminRoute(fin, "/api/admin/staff")).toBe(false);
    expect(canWriteAdminRoute(fin, "/api/admin/configuracoes")).toBe(false);
  });

  it("rotas com autorização própria não recebem gate extra", () => {
    expect(adminWritePermissions("/api/admin/staff")).toBeNull();
    expect(adminWritePermissions("/api/admin/notificacoes/templates")).toBeNull();
    expect(adminReadPermissions("/api/admin/integrations/status")).toBeNull();
    expect(canWriteAdminRoute(pessoa("administrativo", []), "/api/admin/configuracoes")).toBe(true);
  });
});
