import { describe, expect, it } from "vitest";
import {
  PRAZO_LIBERACAO_CIRURGICA_DIAS_UTEIS,
  adicionarDiasUteis,
  calcularLiberacaoCirurgica,
  dataSaoPaulo,
} from "./surgery-release";

/**
 * Testes de CARACTERIZAÇÃO do comportamento ATUAL (Fase 0 do plano de evolução).
 * Objetivo: travar o comportamento hoje vigente (5 dias úteis) como baseline,
 * antes da Fase 2 substituir a regra por "até 90 dias corridos". Não validam
 * se a regra de negócio está certa — só o que o código faz hoje.
 */

describe("PRAZO_LIBERACAO_CIRURGICA_DIAS_UTEIS (baseline pré-Fase 2)", () => {
  it("hoje vale 5 dias úteis — será substituído na Fase 2", () => {
    expect(PRAZO_LIBERACAO_CIRURGICA_DIAS_UTEIS).toBe(5);
  });
});

describe("dataSaoPaulo", () => {
  it("mantém uma data já no formato YYYY-MM-DD", () => {
    expect(dataSaoPaulo("2026-09-11")).toBe("2026-09-11");
  });

  it("retorna null para entrada vazia/nula", () => {
    expect(dataSaoPaulo(null)).toBeNull();
    expect(dataSaoPaulo(undefined)).toBeNull();
    expect(dataSaoPaulo("")).toBeNull();
  });

  it("retorna null para data inválida", () => {
    expect(dataSaoPaulo("nao-e-uma-data")).toBeNull();
  });

  it("converte um timestamp ISO com horário para a data civil em America/Sao_Paulo", () => {
    // 2026-09-12T02:30:00Z é 2026-09-11 23:30 em São Paulo (UTC-3)
    expect(dataSaoPaulo("2026-09-12T02:30:00Z")).toBe("2026-09-11");
  });
});

describe("adicionarDiasUteis (baseline pré-Fase 2)", () => {
  it("soma 5 dias úteis a partir de uma sexta-feira, pulando o fim de semana", () => {
    // 2026-09-11 é sexta-feira
    expect(adicionarDiasUteis("2026-09-11", 5)).toBe("2026-09-18");
  });

  it("soma 5 dias úteis a partir de uma segunda-feira", () => {
    // 2026-09-14 é segunda-feira
    expect(adicionarDiasUteis("2026-09-14", 5)).toBe("2026-09-21");
  });

  it("com 0 dias retorna a própria data", () => {
    expect(adicionarDiasUteis("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("lança erro para data em formato inválido", () => {
    expect(() => adicionarDiasUteis("11/09/2026", 5)).toThrow("DATA_INVALIDA");
  });
});

describe("calcularLiberacaoCirurgica (baseline pré-Fase 2 — regra atual de 5 dias úteis)", () => {
  it("retorna null quando termos e quitação estão ausentes", () => {
    expect(calcularLiberacaoCirurgica(null, null)).toBeNull();
    expect(calcularLiberacaoCirurgica(undefined, undefined)).toBeNull();
  });

  it("retorna null quando só os termos foram assinados (falta quitação)", () => {
    expect(calcularLiberacaoCirurgica("2026-09-11", null)).toBeNull();
  });

  it("retorna null quando só a quitação foi confirmada (faltam os termos)", () => {
    expect(calcularLiberacaoCirurgica(null, "2026-09-11")).toBeNull();
  });

  it("usa a quitação como base quando ela é posterior aos termos, +5 dias úteis", () => {
    // termos em 11/09 (sexta), quitação em 14/09 (segunda) -> base = 14/09
    expect(calcularLiberacaoCirurgica("2026-09-11", "2026-09-14")).toBe("2026-09-21");
  });

  it("usa os termos como base quando eles são posteriores à quitação, +5 dias úteis", () => {
    // quitação em 11/09 (sexta), termos em 18/09 (sexta seguinte) -> base = 18/09
    expect(calcularLiberacaoCirurgica("2026-09-18", "2026-09-11")).toBe("2026-09-25");
  });

  it("quando termos e quitação são no mesmo dia, usa esse dia como base", () => {
    expect(calcularLiberacaoCirurgica("2026-09-11", "2026-09-11")).toBe("2026-09-18");
  });
});
