import { describe, expect, it } from "vitest";
import {
  PRAZO_PADRAO_LIBERACAO_CIRURGICA_DIAS_UTEIS,
  adicionarDiasCorridos,
  adicionarDiasUteis,
  agendaCirurgicaLiberada,
  calcularLiberacaoCirurgica,
  calcularPrazoCirurgicoComAjuste,
  dataSaoPaulo,
  ehDiaUtil,
  proximoDiaUtil,
} from "./surgery-release";

/**
 * V46: a janela de liberação da agenda cirúrgica voltou a ser "5 dias
 * úteis" (baseline original, Fase 0) — a regra de "até 90 dias corridos"
 * (Fase 2) está superada para este fluxo. Gatilho duplo mantido: termos
 * assinados + quitação confirmada, nenhum dos dois isoladamente inicia a
 * janela. Novidades: extensão manual em dias úteis e liberação antecipada.
 */

describe("PRAZO_PADRAO_LIBERACAO_CIRURGICA_DIAS_UTEIS", () => {
  it("vale 5 dias úteis", () => {
    expect(PRAZO_PADRAO_LIBERACAO_CIRURGICA_DIAS_UTEIS).toBe(5);
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
    expect(adicionarDiasCorridos("2026-09-11", 90)).toBe("2026-12-10");
  });

  it("com 0 dias retorna a própria data", () => {
    expect(adicionarDiasCorridos("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("lança erro para data em formato inválido", () => {
    expect(() => adicionarDiasCorridos("11/09/2026", 90)).toThrow("DATA_INVALIDA");
  });
});

describe("ehDiaUtil", () => {
  it("considera sábado e domingo como não úteis", () => {
    // 2026-09-12 é sábado, 2026-09-13 é domingo.
    expect(ehDiaUtil("2026-09-12")).toBe(false);
    expect(ehDiaUtil("2026-09-13")).toBe(false);
  });

  it("considera segunda a sexta como dias úteis", () => {
    expect(ehDiaUtil("2026-09-14")).toBe(true);
    expect(ehDiaUtil("2026-09-11")).toBe(true);
  });
});

describe("adicionarDiasUteis", () => {
  it("pula fins de semana ao somar dias úteis", () => {
    // 2026-09-11 é sexta-feira; +5 dias úteis cruza um fim de semana.
    // sáb 12 e dom 13 não contam -> seg 14, ter 15, qua 16, qui 17, sex 18.
    expect(adicionarDiasUteis("2026-09-11", 5)).toBe("2026-09-18");
  });

  it("com 0 dias retorna a própria data", () => {
    expect(adicionarDiasUteis("2026-09-11", 0)).toBe("2026-09-11");
  });

  it("partindo de uma sexta, +1 dia útil cai na segunda seguinte", () => {
    expect(adicionarDiasUteis("2026-09-11", 1)).toBe("2026-09-14");
  });
});

describe("proximoDiaUtil", () => {
  it("de uma sexta, o próximo dia útil é a segunda seguinte", () => {
    expect(proximoDiaUtil("2026-09-11")).toBe("2026-09-14");
  });

  it("de uma terça, o próximo dia útil é a quarta", () => {
    expect(proximoDiaUtil("2026-09-15")).toBe("2026-09-16");
  });
});

describe("calcularLiberacaoCirurgica (regra vigente — V46: 5 dias úteis)", () => {
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

  it("usa a quitação como base quando ela é posterior aos termos, +5 dias úteis", () => {
    // termos em 11/09 (sex), quitação em 14/09 (seg) -> base = 14/09 -> +5 dias úteis = 21/09
    expect(calcularLiberacaoCirurgica("2026-09-11", "2026-09-14")).toBe("2026-09-21");
  });

  it("usa os termos como base quando eles são posteriores à quitação, +5 dias úteis", () => {
    // quitação em 11/09 (sex), termos em 18/09 (sex) -> base = 18/09 -> +5 dias úteis = 25/09
    expect(calcularLiberacaoCirurgica("2026-09-18", "2026-09-11")).toBe("2026-09-25");
  });

  it("quando termos e quitação são no mesmo dia, usa esse dia como base", () => {
    expect(calcularLiberacaoCirurgica("2026-09-11", "2026-09-11")).toBe("2026-09-18");
  });
});

describe("calcularPrazoCirurgicoComAjuste", () => {
  it("sem dias extras, é igual ao prazo padrão", () => {
    expect(calcularPrazoCirurgicoComAjuste("2026-09-11", "2026-09-11", 0)).toBe("2026-09-18");
    expect(calcularPrazoCirurgicoComAjuste("2026-09-11", "2026-09-11", null)).toBe("2026-09-18");
  });

  it("soma dias úteis extras por cima do prazo padrão", () => {
    // prazo padrão 18/09 (sex) + 3 dias úteis -> 23/09 (qua)
    expect(calcularPrazoCirurgicoComAjuste("2026-09-11", "2026-09-11", 3)).toBe("2026-09-23");
  });

  it("retorna null quando o prazo base não pode ser calculado, mesmo com dias extras", () => {
    expect(calcularPrazoCirurgicoComAjuste(null, "2026-09-11", 5)).toBeNull();
  });
});

describe("agendaCirurgicaLiberada", () => {
  const base = { termosAssinadosEm: "2026-09-11", custeioConfirmadoEm: "2026-09-11", diasExtras: 0 };

  it("não libera antes do prazo, sem liberação manual", () => {
    expect(agendaCirurgicaLiberada({ ...base, liberadaManualmenteEm: null, hojeIso: "2026-09-17" })).toBe(false);
  });

  it("libera no dia exato do prazo calculado", () => {
    expect(agendaCirurgicaLiberada({ ...base, liberadaManualmenteEm: null, hojeIso: "2026-09-18" })).toBe(true);
  });

  it("libera após o prazo calculado", () => {
    expect(agendaCirurgicaLiberada({ ...base, liberadaManualmenteEm: null, hojeIso: "2026-09-30" })).toBe(true);
  });

  it("libera imediatamente quando há liberação manual, mesmo antes do prazo", () => {
    expect(agendaCirurgicaLiberada({ ...base, liberadaManualmenteEm: "2026-09-12T10:00", hojeIso: "2026-09-12" })).toBe(true);
  });

  it("não libera quando termos/quitação ainda não existem, mesmo com data futura", () => {
    expect(
      agendaCirurgicaLiberada({
        termosAssinadosEm: null,
        custeioConfirmadoEm: null,
        diasExtras: 0,
        liberadaManualmenteEm: null,
        hojeIso: "2026-12-31",
      }),
    ).toBe(false);
  });
});
