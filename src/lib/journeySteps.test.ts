import { describe, expect, it } from "vitest";
import { deriveJourneySteps, journeyInputFromProcess, type JourneyProcessSnapshot, type JourneyStepsInput } from "./journeySteps";

const base: JourneyStepsInput = {
  percentualPagamento: 0,
  percentualAtingido: false,
  statusRevisao: null,
  custeioStatus: null,
  agendada: false,
  termosAssinados: false,
  agendaCirurgicaLiberada: false,
  cirurgiaAgendada: false,
  cirurgiaRealizada: false,
};

describe("deriveJourneySteps", () => {
  it("mantém as 8 etapas fixas do produto, na ordem real (custeio antes da assinatura)", () => {
    const passos = deriveJourneySteps(base);
    expect(passos.map((p) => p.id)).toEqual([
      "contratar", "pagamento", "levantamento", "custeio", "assinatura", "liberacao-cirurgica", "data-cirurgia", "cirurgia",
    ]);
    expect(passos[0].status).toBe("done");
  });

  it("marca a etapa de pagamento como atual enquanto o percentual não foi atingido", () => {
    const passos = deriveJourneySteps({ ...base, percentualPagamento: 30 });
    expect(passos[1].status).toBe("current");
    expect(passos[2].status).toBe("upcoming"); // levantamento
  });

  it("libera o levantamento como etapa atual quando o percentual é atingido", () => {
    const passos = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "pendente" });
    expect(passos[1].status).toBe("done"); // pagamento
    expect(passos[2].status).toBe("current"); // levantamento
    expect(passos[3].status).toBe("upcoming"); // custeio
  });

  it("não trata revisão recusada como aprovada", () => {
    const passos = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "recusada" });
    expect(passos[2].status).toBe("current");
  });

  it("libera a etapa de custeio quando o levantamento é aprovado", () => {
    const passos = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "aprovada" });
    expect(passos[2].status).toBe("done");
    expect(passos[3].status).toBe("current");
  });

  it("conclui o custeio somente quando a solicitação de custeio é aprovada (não basta estar em análise)", () => {
    const emAnalise = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "aprovada", custeioStatus: "em_analise" });
    expect(emAnalise[3].status).toBe("current");
    expect(emAnalise[4].status).toBe("upcoming");

    const aprovado = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "aprovada", custeioStatus: "aprovada" });
    expect(aprovado[3].status).toBe("done");
    expect(aprovado[4].status).toBe("current"); // assinatura
  });

  it("conclui a assinatura apenas quando os termos foram assinados", () => {
    const marcada = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "aprovada", custeioStatus: "aprovada", agendada: true });
    expect(marcada[4].status).toBe("current");

    const assinada = deriveJourneySteps({ ...base, percentualAtingido: true, statusRevisao: "aprovada", custeioStatus: "aprovada", agendada: true, termosAssinados: true });
    expect(assinada[4].status).toBe("done");
    expect(assinada[5].status).toBe("current"); // liberação da agenda cirúrgica
  });

  it("avança até a cirurgia realizada quando todas as etapas anteriores estão concluídas", () => {
    const passos = deriveJourneySteps({
      percentualPagamento: 100,
      percentualAtingido: true,
      statusRevisao: "aprovada",
      custeioStatus: "aprovada",
      agendada: true,
      termosAssinados: true,
      agendaCirurgicaLiberada: true,
      cirurgiaAgendada: true,
      cirurgiaRealizada: true,
    });
    expect(passos.every((p) => p.status === "done")).toBe(true);
  });
});

describe("journeyInputFromProcess (app e drawer administrativo usam o mesmo adaptador)", () => {
  const snap: JourneyProcessSnapshot = {
    percentualPagamento: 100,
    percentualAtingido: true,
    statusRevisao: "aprovada",
    custeioStatus: "aprovada",
    temAgendamentoTermos: true,
    comparecimentoConfirmado: true,
    processoConcluido: false,
    agendaCirurgicaLiberadaEm: "2026-10-05T11:00:00Z",
    dataCirurgia: null,
    cirurgiaRealizada: false,
  };

  it("com agenda liberada e sem data escolhida, a etapa atual é a escolha da data", () => {
    const passos = deriveJourneySteps(journeyInputFromProcess(snap));
    expect(passos.find((p) => p.id === "liberacao-cirurgica")?.status).toBe("done");
    expect(passos.find((p) => p.id === "data-cirurgia")?.status).toBe("current");
  });

  it("depois de escolher a data da cirurgia, a liberação continua concluída", () => {
    const passos = deriveJourneySteps(journeyInputFromProcess({ ...snap, dataCirurgia: "2026-10-22" }));
    expect(passos.find((p) => p.id === "liberacao-cirurgica")?.status).toBe("done");
    expect(passos.find((p) => p.id === "data-cirurgia")?.status).toBe("done");
    expect(passos.find((p) => p.id === "cirurgia")?.status).toBe("current");
  });

  it("processo concluído conta os termos como assinados mesmo sem o status de comparecimento", () => {
    const input = journeyInputFromProcess({ ...snap, comparecimentoConfirmado: false, processoConcluido: true, dataCirurgia: "2026-10-22", cirurgiaRealizada: true });
    expect(input.termosAssinados).toBe(true);
    expect(deriveJourneySteps(input).every((p) => p.status === "done")).toBe(true);
  });
});
