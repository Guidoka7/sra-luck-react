import { describe, expect, it } from "vitest";
import { ETAPAS, bloqueios, contarAcaoEquipe, faseLevantamento, faseLiberacao, prazoLevantamento, situacao } from "./jornada";
import type { VisaoGeralResponse } from "./types";
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

  it("depois do levantamento: forma de pagamento e depois data, ambas com a cliente", () => {
    const semForma = cartao({ statusRevisaoFinanceira: "aprovada" });
    expect(faseLevantamento(semForma)).toBe("forma");
    expect(situacao(semForma, "financialReview", HOJE)).toMatchObject({ responsavel: "cliente", acao: null });
    const comForma = cartao({ statusRevisaoFinanceira: "aprovada", custeioStatus: "aprovada", custeioForma: "pix" });
    expect(faseLevantamento(comForma)).toBe("data");
    expect(situacao(comForma, "financialReview", HOJE)).toMatchObject({ responsavel: "cliente", prazo: "pagamento escolhido: PIX" });
    expect(situacao(cartao({ statusRevisaoFinanceira: "recusada" }), "financialReview", HOJE)).toMatchObject({ texto: expect.stringContaining("Divergência"), acao: { id: "levantamento", rotulo: "Refazer levantamento" } });
  });

  it("sem datas de termos abertas, a cliente pronta vira pendência da equipe", () => {
    const pronta = cartao({ statusRevisaoFinanceira: "aprovada", custeioStatus: "aprovada" });
    expect(situacao(pronta, "financialReview", HOJE, { vagasTermos: 0, vagasCirurgia: null })).toMatchObject({ responsavel: "equipe", acao: { id: "abrirDatasTermos" } });
  });

  it("identifica quem voltou por ausência nos termos", () => {
    const voltou = cartao({ statusRevisaoFinanceira: "aprovada", custeioStatus: "aprovada", retornoTermos: { motivo: "ausencia", em: "2026-09-21T15:00:00Z", dataTermos: "2026-09-21" } });
    expect(situacao(voltou, "financialReview", HOJE).texto).toBe("Faltou nos termos de 21/09/2026 · aguardando nova data");
  });
});

describe("termos agendados", () => {
  it("preparar = responsável + previsão cirúrgica antes do dia", () => {
    expect(situacao(cartao({ dataTermos: "2026-09-30", horarioTermos: "10:00" }), "termsConfirmed", HOJE)).toMatchObject({ responsavel: "equipe", prazo: "30/09/2026 às 10:00 · em 2 dias" });
    expect(situacao(cartao({ dataTermos: "2026-09-29", termosResponsavel: "Marina" }), "termsConfirmed", HOJE)).toMatchObject({ responsavel: "equipe", texto: "Preparar atendimento · falta previsão cirúrgica", acao: { id: "preparar" } });
    expect(situacao(cartao({ dataTermos: "2026-09-29", termosResponsavel: "Marina", previsaoConfirmadaEm: "2026-09-25T10:00:00Z" }), "termsConfirmed", HOJE)).toMatchObject({ responsavel: "sistema", texto: "Tudo pronto · assinatura com Marina", acao: null });
  });
});

describe("liberação cirúrgica", () => {
  it("no dia dos termos lista exatamente o que falta registrar", () => {
    const s = situacao(cartao({ dataTermos: HOJE }), "financialRelease", HOJE);
    expect(s).toMatchObject({ responsavel: "equipe", texto: "Registrar previsão, comparecimento e quitação", prazo: "termos hoje", atrasado: false, acao: { id: "atendimento" } });
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
    expect(situacao(c, "financialRelease", HOJE)).toMatchObject({ responsavel: "equipe", tom: "danger", atrasado: true, acao: { id: "liberar", rotulo: "Liberar agora" } });
  });

  it("agenda liberada sem datas cirúrgicas abertas trava a cliente", () => {
    const c = cartao({ comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-09-10", quitacaoEm: "2026-09-10", agendaCirurgicaLiberadaEm: "2026-09-17T03:00:00Z" });
    expect(situacao(c, "financialRelease", HOJE, { vagasTermos: null, vagasCirurgia: 0 })).toMatchObject({ responsavel: "equipe", acao: { id: "abrirDatasCirurgia" } });
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

describe("bloqueios da operação", () => {
  const filas = { preEligibility: [], financialReview: [cartao({ statusRevisaoFinanceira: "aprovada", custeioStatus: "aprovada" })], termsConfirmed: [], financialRelease: [], surgeryConfirmed: [] };
  it("avisa quando clientes prontas não têm data de termos para escolher", () => {
    const dados: VisaoGeralResponse = { hoje: HOJE, filas, disponibilidade: { termos: { datas: 0, vagas: 0, proxima: null }, cirurgia: { datas: 2, vagas: 3, proxima: "2026-10-06" } } };
    expect(bloqueios(dados).map((b) => b.id)).toEqual(["termos"]);
  });
  it("sem dados de disponibilidade não inventa alerta", () => {
    expect(bloqueios({ hoje: HOJE, filas, disponibilidade: null })).toEqual([]);
  });
});
