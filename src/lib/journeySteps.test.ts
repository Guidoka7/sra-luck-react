import { describe, expect, it } from "vitest";
import { deriveJourneySteps } from "./journeySteps";

const base = {
  porcentagemPagamento: 0,
  percentualAtingido: false,
  statusRevisaoFinanceira: null as "pendente" | "aprovada" | "recusada" | null,
  agendaLiberada: false,
  agendamentoAtivo: null,
  agendamentoConcluido: null,
};

describe("deriveJourneySteps", () => {
  it("marca a agenda como bloqueada enquanto o percentual não foi atingido (Estado A)", () => {
    const passos = deriveJourneySteps({ ...base, porcentagemPagamento: 30 });
    expect(passos[1].status).toBe("current"); // Parcelas em andamento
    expect(passos[2].status).toBe("upcoming"); // Percentual mínimo atingido
    expect(passos[3].status).toBe("upcoming"); // Levantamento financeiro
  });

  it("marca o levantamento como em andamento quando o percentual foi atingido mas a revisão ainda não foi aprovada (Estado B)", () => {
    const passos = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisaoFinanceira: "pendente" });
    expect(passos[2].status).toBe("done");
    expect(passos[3].status).toBe("current");
    expect(passos[4].status).toBe("upcoming");
  });

  it("não trata revisão recusada como aprovada (Estado C)", () => {
    const passos = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisaoFinanceira: "recusada" });
    expect(passos[3].status).toBe("current");
  });

  it("libera a etapa de agenda quando a revisão financeira é aprovada (Estado D)", () => {
    const passos = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisaoFinanceira: "aprovada" });
    expect(passos[3].status).toBe("done");
    expect(passos[4].status).toBe("current");
  });

  it("conclui a etapa de assinatura quando já existe agendamento confirmado", () => {
    const passos = deriveJourneySteps({
      ...base,
      percentualAtingido: true,
      statusRevisaoFinanceira: "aprovada",
      agendamentoConcluido: { previsaoLiberacaoFinanceira: null },
    });
    expect(passos[4].status).toBe("done");
    expect(passos[5].status).toBe("current"); // Definição do custeio
  });

  it("marca a agenda cirúrgica e a cirurgia de acordo com a previsão de liberação financeira", () => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 3);
    const dataFutura = amanha.toISOString().slice(0, 10);

    const passosFuturos = deriveJourneySteps({
      ...base,
      percentualAtingido: true,
      statusRevisaoFinanceira: "aprovada",
      agendamentoConcluido: { previsaoLiberacaoFinanceira: dataFutura },
    });
    expect(passosFuturos[5].status).toBe("done");
    expect(passosFuturos[6].status).toBe("current"); // ainda não chegou a data
    expect(passosFuturos[7].status).toBe("upcoming");

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const dataPassada = ontem.toISOString().slice(0, 10);

    const passosPassados = deriveJourneySteps({
      ...base,
      percentualAtingido: true,
      statusRevisaoFinanceira: "aprovada",
      agendamentoConcluido: { previsaoLiberacaoFinanceira: dataPassada },
    });
    expect(passosPassados[6].status).toBe("done");
    expect(passosPassados[7].status).toBe("current");
  });

  it("mantém a etapa de contrato sempre concluída e não inventa etapas fora das 8 fixas", () => {
    const passos = deriveJourneySteps(base);
    expect(passos).toHaveLength(8);
    expect(passos[0].status).toBe("done");
    expect(passos[0].nome).toBe("Contrato confirmado");
  });
});
