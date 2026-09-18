import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApi = readFileSync(new URL("./admin-api.ts", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../src/components/admin/clientes/ClienteDetailDrawer.tsx", import.meta.url), "utf8");

describe("drawer Financeiro — jornada no schema real", () => {
  it("não consulta contratos_credito no endpoint administrativo da cliente", () => {
    const inicio = adminApi.indexOf("const jornadaCliente=");
    const fim = adminApi.indexOf("const historicoCliente=", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const bloco = adminApi.slice(inicio, fim);

    expect(bloco).not.toContain('from("contratos_credito")');
    expect(bloco).toContain('from("clientes")');
    expect(bloco).toContain('from("agendamentos")');
    expect(bloco).toContain('fonte:"modelo_real_clientes_agendamentos"');
  });

  it("Financeiro continua carregando mesmo se a jornada opcional falhar", () => {
    expect(drawer).toContain("apiJson<DrawerJourneyResponse>(`/api/admin/clientes/${id}/jornada`).catch(() => ({ contrato: null }))");
    expect(drawer).toContain("apiJson<DrawerPlanResponse>(`/api/admin/clientes/${id}/boletos`)");
    expect(drawer).toContain("apiJson<DrawerHistoryResponse>(`/api/admin/clientes/${id}/historico`)");
  });
});
