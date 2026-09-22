import { describe, expect, it } from "vitest";
import { estadoLiberacao, rotuloLevantamento, rotuloLiberacao } from "./v46Cards";
import type { CartaoCliente } from "./types";

const base = {
  comparecimentoStatus: "pendente", quitacaoStatus: "pendente", comparecimentoEm: null, quitacaoEm: null,
  agendaCirurgicaLiberadaEm: null, prazoAjusteDias: 0, prazoCirurgico: null, statusRevisaoFinanceira: null,
} as unknown as CartaoCliente;

describe("Etapa 4 (somente exibição)", () => {
  it("sem conferência presencial mostra a pendência do dia", () => {
    expect(rotuloLiberacao(base, "2026-10-10")).toMatchObject({ texto: "Hoje · conferir atendimento", passo: 0 });
  });
  it("comparecimento sem quitação indica o que falta", () => {
    expect(rotuloLiberacao({ ...base, comparecimentoStatus: "compareceu" }, "2026-10-10").texto).toBe("Compareceu · falta quitação");
  });
  it("conta dias úteis a partir da última confirmação e soma o ajuste de prazo", () => {
    const c = { ...base, comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-10-01T13:00:00Z", quitacaoEm: "2026-10-02T13:00:00Z", prazoAjusteDias: 3 } as CartaoCliente;
    const e = estadoLiberacao(c, "2026-10-07"); // sex 02 → seg 05, ter 06, qua 07
    expect(e).toMatchObject({ ambos: true, inicio: "2026-10-02", decorridos: 3, totalDias: 8 });
    expect(rotuloLiberacao(c, "2026-10-07").texto).toBe("Prazo · 3 de 8 dias úteis");
  });
  it("agenda liberada vence qualquer contagem", () => {
    const c = { ...base, comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-10-01", quitacaoEm: "2026-10-01", agendaCirurgicaLiberadaEm: "2026-10-03T10:00:00Z" } as CartaoCliente;
    expect(rotuloLiberacao(c, "2026-10-05")).toMatchObject({ tom: "success", passo: 4 });
  });
});

describe("Levantamento", () => {
  it("mapeia o status real da revisão financeira", () => {
    expect(rotuloLevantamento({ ...base, statusRevisaoFinanceira: "aprovada" }).texto).toBe("Levantamento concluído");
    expect(rotuloLevantamento({ ...base, statusRevisaoFinanceira: "recusada" }).tom).toBe("danger");
    expect(rotuloLevantamento({ ...base, statusRevisaoFinanceira: "pendente" }).texto).toBe("Em análise");
    expect(rotuloLevantamento(base).texto).toBe("Aguardando");
  });
});
