import { describe, expect, it } from "vitest";
import { ETAPAS, contarAcaoEquipe, faseLiberacao, prazoLevantamento, situacao } from "./jornada";
import type { CartaoCliente } from "./types";

const HOJE = "2026-09-28"; // segunda-feira

function cartao(extra: Partial<CartaoCliente> = {}): CartaoCliente {
  return {
    id: "c1", nome: "Cliente", cpf: null, procedimento: null, cartaDeCredito: 20000, totalParcelas: 12, parcelasPagas: 6,
    parcelasFaltantes: 2, agendamentoId: "ag", dataTermos: null, horarioTermos: null, termosResponsavel: null,
    comparecimentoStatus: "pendente", quitacaoStatus: "pendente", previsaoCirurgia: null, previsaoConfirmadaEm: null,
    agendaCirurgicaLiberadaEm: null, dataCirurgia: null, pagamentoCirurgiaConfirmadoEm: null, prazoCirurgico: null,
    liberacaoFinanceiraSolicitadaEm: null, parcelasNecessarias: 8, percentualRegra: 60, statusCirurgia: null,
    custeioStatus: null, custeioForma: null, custeioSaldo: null, statusRevisaoFinanceira: null, financeiroConfirmadoEm: null,
    custeioConfirmadoEm: null, proximaParcelaEm: null, termosAssinadosEm: null, comparecimentoEm: null, quitacaoEm: null,
    prazoAjusteDias: 0, agendaCirurgicaLiberadaManualmente: false, horarioCirurgia: null, cirurgiaEscolhidaEm: null,
    processoConcluidoEm: null, ...extra,
  };
}

describe("etapas da jornada", () => {
  it("cobre as 5 filas da Central na ordem do processo, sempre com o filtro Todas", () => {
    expect(ETAPAS.map((e) => e.id)).toEqual(["preEligibility", "financialReview", "termsConfirmed", "financialRelease", "surgeryConfirmed"]);
    for (const e of ETAPAS) {
      expect(e.segmentos[0].id).toBe("todas");
      expect(e.saida.length).toBeGreaterThan(20);
    }
  });

  it("Pagando parcelas: elegível depende da cliente; filtro de faltantes inclui 3 ou mais", () => {
    expect(situacao(cartao({ parcelasFaltantes: 0 }), "preEligibility", HOJE)).toMatchObject({ responsavel: "cliente", tom: "success" });
    const faltam3 = ETAPAS[0].segmentos.find((s) => s.id === "falta3")!;
    expect(faltam3.filtro(cartao({ parcelasFaltantes: 6 }), HOJE)).toBe(true);
  });
});

describe("levantamento financeiro", () => {
  it("prazo de 5 dias úteis a partir da solicitação", () => {
    // seg 14/09 + 5 dias úteis = seg 21/09
    expect(prazoLevantamento(cartao({ liberacaoFinanceiraSolicitadaEm: "2026-09-14T13:00:00Z" }))).toBe("2026-09-21");
  });

  it("prazo vencido é da equipe e fica em destaque", () => {
    const s = situacao(cartao({ liberacaoFinanceiraSolicitadaEm: "2026-09-14T13:00:00Z" }), "financialReview", HOJE);
    expect(s).toMatchObject({ responsavel: "equipe", tom: "danger", atrasado: true, urgencia: 0 });
    expect(s.prazo).toBe("prazo 21/09/2026 · 7 dias em atraso");
  });

  it("concluído passa a depender da cliente escolher a data", () => {
    expect(situacao(cartao({ statusRevisaoFinanceira: "aprovada" }), "financialReview", HOJE).responsavel).toBe("cliente");
    expect(situacao(cartao({ statusRevisaoFinanceira: "recusada" }), "financialReview", HOJE).texto).toContain("Divergência");
  });
});

describe("termos agendados", () => {
  it("sem responsável pede ação da equipe; com responsável segue automático", () => {
    expect(situacao(cartao({ dataTermos: "2026-09-30", horarioTermos: "10:00" }), "termsConfirmed", HOJE)).toMatchObject({ responsavel: "equipe", prazo: "30/09/2026 às 10:00 · em 2 dias" });
    expect(situacao(cartao({ dataTermos: "2026-09-29", termosResponsavel: "Marina" }), "termsConfirmed", HOJE)).toMatchObject({ responsavel: "sistema", texto: "Assinatura com Marina" });
  });
});

describe("liberação cirúrgica", () => {
  it("no dia dos termos lista exatamente o que falta registrar", () => {
    const s = situacao(cartao({ dataTermos: HOJE }), "financialRelease", HOJE);
    expect(s).toMatchObject({ responsavel: "equipe", texto: "Registrar previsão, comparecimento e quitação", prazo: "termos hoje", atrasado: false });
  });

  it("registro atrasado depois do dia dos termos vira urgente", () => {
    const s = situacao(cartao({ dataTermos: "2026-09-22", previsaoConfirmadaEm: "x", comparecimentoStatus: "compareceu", comparecimentoEm: "2026-09-22" }), "financialRelease", HOJE);
    expect(s).toMatchObject({ texto: "Registrar quitação", tom: "danger", atrasado: true });
  });

  it("com os dois registros conta o prazo automaticamente", () => {
    const c = cartao({ dataTermos: "2026-09-21", comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-09-21", quitacaoEm: "2026-09-23", prazoCirurgico: "2026-09-30" });
    expect(faseLiberacao(c, HOJE)).toBe("prazo");
    expect(situacao(c, "financialRelease", HOJE)).toMatchObject({ responsavel: "sistema", texto: "Contando o prazo · 3 de 5 dias úteis", prazo: "libera em 30/09/2026" });
  });

  it("prazo vencido sem liberação volta para a equipe", () => {
    const c = cartao({ comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-09-10", quitacaoEm: "2026-09-10", prazoCirurgico: "2026-09-17" });
    expect(situacao(c, "financialRelease", HOJE)).toMatchObject({ responsavel: "equipe", tom: "danger", atrasado: true });
  });

  it("não comparecimento é pendência; agenda liberada depende da cliente", () => {
    expect(faseLiberacao(cartao({ comparecimentoStatus: "nao_compareceu" }), HOJE)).toBe("pendencia");
    expect(situacao(cartao({ comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-09-10", quitacaoEm: "2026-09-10", agendaCirurgicaLiberadaEm: "2026-09-17T03:00:00Z" }), "financialRelease", HOJE).responsavel).toBe("cliente");
  });
});

describe("cirurgia agendada", () => {
  it("depois da data, a equipe confirma o pagamento", () => {
    expect(situacao(cartao({ dataCirurgia: "2026-09-20" }), "surgeryConfirmed", HOJE).responsavel).toBe("equipe");
    expect(situacao(cartao({ dataCirurgia: "2026-10-01" }), "surgeryConfirmed", HOJE).responsavel).toBe("sistema");
  });

  it("conta quantas clientes da etapa dependem da equipe", () => {
    const lista = [cartao({ dataCirurgia: "2026-09-20" }), cartao({ dataCirurgia: "2026-10-01" })];
    expect(contarAcaoEquipe(lista, "surgeryConfirmed", HOJE)).toBe(1);
  });
});
