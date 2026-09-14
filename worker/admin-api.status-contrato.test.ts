import { describe, expect, it } from "vitest";
import { validarTransicaoStatusContrato } from "./admin-api";

describe("validarTransicaoStatusContrato (Fase 1 — status de contrato)", () => {
  it("rejeita status desconhecido", () => {
    const r = validarTransicaoStatusContrato({ status: "bloqueado" }, "ativo");
    expect(r).toHaveProperty("erro");
  });

  it("rejeita transição para o mesmo status atual", () => {
    const r = validarTransicaoStatusContrato({ status: "ativo" }, "ativo");
    expect(r).toHaveProperty("erro");
  });

  it("suspender exige data inicial válida", () => {
    const semData = validarTransicaoStatusContrato({ status: "suspenso" }, "ativo");
    expect(semData).toHaveProperty("erro");

    const dataInvalida = validarTransicaoStatusContrato({ status: "suspenso", suspensoDesde: "11/09/2026" }, "ativo");
    expect(dataInvalida).toHaveProperty("erro");
  });

  it("suspender sem data final = suspensão por prazo indeterminado", () => {
    const r = validarTransicaoStatusContrato({ status: "suspenso", suspensoDesde: "2026-09-14", motivo: "Inadimplência" }, "ativo");
    if ("erro" in r) throw new Error(`não deveria falhar: ${r.erro}`);
    expect(r.patch).toEqual({
      status_contrato: "suspenso",
      suspenso_desde: "2026-09-14",
      suspenso_ate: null,
      suspensao_motivo: "Inadimplência",
    });
  });

  it("rejeita data final anterior à data inicial", () => {
    const r = validarTransicaoStatusContrato({ status: "suspenso", suspensoDesde: "2026-09-14", suspensoAte: "2026-09-01" }, "ativo");
    expect(r).toHaveProperty("erro");
  });

  it("aceita janela de suspensão com data final", () => {
    const r = validarTransicaoStatusContrato({ status: "suspenso", suspensoDesde: "2026-09-14", suspensoAte: "2026-10-14" }, "ativo");
    if ("erro" in r) throw new Error(`não deveria falhar: ${r.erro}`);
    expect(r.patch.suspenso_desde).toBe("2026-09-14");
    expect(r.patch.suspenso_ate).toBe("2026-10-14");
  });

  it("reativar (voltar a 'ativo') limpa a janela de suspensão e o motivo", () => {
    const r = validarTransicaoStatusContrato({ status: "ativo" }, "suspenso");
    if ("erro" in r) throw new Error(`não deveria falhar: ${r.erro}`);
    expect(r.patch).toEqual({ status_contrato: "ativo", suspenso_desde: null, suspenso_ate: null, suspensao_motivo: null });
  });

  it("negativado/cancelado não exigem data, mas aceitam motivo opcional", () => {
    const negativado = validarTransicaoStatusContrato({ status: "negativado", motivo: "Cobrança judicial" }, "ativo");
    if ("erro" in negativado) throw new Error(`não deveria falhar: ${negativado.erro}`);
    expect(negativado.patch).toEqual({ status_contrato: "negativado", suspenso_desde: null, suspenso_ate: null, suspensao_motivo: "Cobrança judicial" });

    const cancelado = validarTransicaoStatusContrato({ status: "cancelado" }, "ativo");
    if ("erro" in cancelado) throw new Error(`não deveria falhar: ${cancelado.erro}`);
    expect(cancelado.patch.suspensao_motivo).toBeNull();
  });
});
