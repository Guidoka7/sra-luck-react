import { describe, expect, it } from "vitest";
import { deveMostrarEscolhaCusteio, statusAgenda } from "./AgendaHome";

const base = {
  agendamentoAtivo: null,
  agendamentoConcluido: null,
  podeAgendar: true,
  agendaLiberada: false,
  statusRevisaoFinanceira: "aprovada" as const,
  custeioAprovado: false,
};

describe("AgendaHome — transição para Etapa 3", () => {
  it("abre a escolha de pagamento assim que o levantamento é aprovado, mesmo antes de agenda_liberada", () => {
    expect(deveMostrarEscolhaCusteio("aprovada", false)).toBe(true);
    expect(statusAgenda(base).label).toBe("Etapa 3 de 4");
  });

  it("mantém Etapa 2 enquanto o levantamento ainda não foi aprovado", () => {
    expect(deveMostrarEscolhaCusteio("pendente", false)).toBe(false);
    expect(statusAgenda({ ...base, statusRevisaoFinanceira: "pendente" }).label).toBe("Etapa 2 de 4");
  });

  it("só mostra Etapa 4 quando a forma já foi escolhida e o calendário está liberado", () => {
    expect(statusAgenda({ ...base, custeioAprovado: true, agendaLiberada: false }).label).toBe("Etapa 3 de 4");
    expect(statusAgenda({ ...base, custeioAprovado: true, agendaLiberada: true }).label).toBe("Etapa 4 de 4");
  });

  it("preserva o estado de ajuste quando o levantamento foi recusado", () => {
    expect(statusAgenda({ ...base, statusRevisaoFinanceira: "recusada" }).label).toBe("Ajuste necessário");
  });
});
