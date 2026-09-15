import { describe, expect, it } from "vitest";
import {
  PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS_CORRIDOS,
  adicionarDiasCorridos,
  calcularLiberacaoCirurgica,
  dataSaoPaulo,
} from "./surgery-release";

/**
 * Fase 2: a janela de liberação da agenda cirúrgica deixou de ser "5 dias
 * úteis" (baseline caracterizado na Fase 0) e passou a ser um PRAZO MÁXIMO
 * de 90 dias corridos, com gatilho duplo (termos assinados + quitação
 * confirmada — nenhum dos dois isoladamente inicia a janela) e sem piso
 * mínimo de espera (a liberação pode ocorrer antes do teto).
 */

describe("PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS_CORRIDOS", () => {
  it("vale 90 dias corridos", () => {
    expect(PRAZO_MAXIMO_LIBERACAO_CIRURGICA_DIAS_CORRIDOS).toBe(90);
  });
});

describe("dataSaoPaulo", () => {
  it("mantém uma data já no formato YYYY-MM-DD", () => {
    expect(dataSaoPaulo("2026-09-11")).toBe("2026-09-11");
  });

  it("retorna null para entrada vazia/nula/inválida", () => {
    expect(dataSaoPaulo(null)).toBeNull();
    expect(dataSaoPaulo(undefined)).toBeNull();
    expect(dataSaoPaulo("")).toBeNull();
    expect(dataSaoPaulo("nao-e-uma-data")).toBeNull();
  });

  it("converte um timestamp ISO com horário para a data civil em America/Sao_Paulo", () => {
    expect(dataSaoPaulo("2026-09-12T02:30:00Z")).toBe("2026-09-11");
  });
});

describe("adicionarDiasCorridos", () => {
  it("soma dias corridos sem pular fim de semana", () => {
    // 2026-09-11 é sexta-feira; +90 dias corridos cai num dia qualquer da semana.
    expect(adicionarDiasCorridos("2026-09-11", 90)).toBe("2026-12-10");
  });

  it("com 0 dias retorna a própria data", () => {
    expect(adicionarDiasCorridos("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("lança erro para data em formato inválido", () => {
    expect(() => adicionarDiasCorridos("11/09/2026", 90)).toThrow("DATA_INVALIDA");
  });
});

describe("calcularLiberacaoCirurgica (regra vigente — Fase 2: até 90 dias corridos)", () => {
  it("retorna null quando termos e quitação estão ausentes", () => {
    expect(calcularLiberacaoCirurgica(null, null)).toBeNull();
    expect(calcularLiberacaoCirurgica(undefined, undefined)).toBeNull();
  });

  it("retorna null quando só os termos foram assinados (falta quitação) — termos isolado não inicia a janela", () => {
    expect(calcularLiberacaoCirurgica("2026-09-11", null)).toBeNull();
  });

  it("retorna null quando só a quitação foi confirmada (faltam os termos) — quitação isolada não inicia a janela", () => {
    expect(calcularLiberacaoCirurgica(null, "2026-09-11")).toBeNull();
  });

  it("usa a quitação como base quando ela é posterior aos termos, +90 dias corridos", () => {
    // termos em 11/09, quitação em 14/09 -> base = 14/09
    expect(calcularLiberacaoCirurgica("2026-09-11", "2026-09-14")).toBe("2026-12-13");
  });

  it("usa os termos como base quando eles são posteriores à quitação, +90 dias corridos", () => {
    // quitação em 11/09, termos em 18/09 -> base = 18/09
    expect(calcularLiberacaoCirurgica("2026-09-18", "2026-09-11")).toBe("2026-12-17");
  });

  it("quando termos e quitação são no mesmo dia, usa esse dia como base", () => {
    expect(calcularLiberacaoCirurgica("2026-09-11", "2026-09-11")).toBe("2026-12-10");
  });
});
