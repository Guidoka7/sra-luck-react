import { describe, expect, it } from "vitest";
import type { CartaoCliente } from "../../../features/scheduling/types";
import type { LogAlteracao } from "../../../types/database";
import { passosDaJornada, statusDoDrawer } from "./drawerModel";
import { descreverHistorico, ehHistoricoFinanceiro, statusCliente, statusParcela, STATUS_CLIENTE } from "./drawerFormat";

const base = {
  id: "c1", nome: "Cliente QA", totalParcelas: 12, parcelasPagas: 7, parcelasFaltantes: 1, statusRevisaoFinanceira: null,
  custeioStatus: null, dataTermos: null, comparecimentoStatus: "pendente", quitacaoStatus: "pendente", comparecimentoEm: null, quitacaoEm: null,
  agendaCirurgicaLiberadaEm: null, dataCirurgia: null, statusCirurgia: "nao_agendada", prazoAjusteDias: 0, prazoCirurgico: null,
  processoConcluidoEm: null, previsaoConfirmadaEm: null,
} as unknown as CartaoCliente;

describe("cabeçalho do drawer: etapa real persistida", () => {
  it("etapa 1 mostra quantas parcelas faltam", () => {
    expect(statusDoDrawer(base, "preEligibility", false, "2026-10-10")).toBe("Etapa 1 · Falta 1 parcela");
    expect(statusDoDrawer({ ...base, parcelasFaltantes: 0 }, "preEligibility", false, "2026-10-10")).toBe("Etapa 1 · Aguardando solicitação");
  });
  it("etapa 2 distingue levantamento em andamento de concluído", () => {
    expect(statusDoDrawer(base, "financialReview", false, "2026-10-10")).toBe("Etapa 2 · Levantamento");
    expect(statusDoDrawer({ ...base, statusRevisaoFinanceira: "aprovada" }, "financialReview", false, "2026-10-10")).toBe("Etapa 2 · Aguardando escolha dos termos");
  });
  it("etapa 4 segue o estado de liberação (conferência → prazo → liberada)", () => {
    expect(statusDoDrawer(base, "financialRelease", false, "2026-10-10")).toBe("Etapa 4 · Conferência presencial");
    const ambos = { ...base, comparecimentoStatus: "compareceu", quitacaoStatus: "paga", comparecimentoEm: "2026-10-01T13:00:00Z", quitacaoEm: "2026-10-02T13:00:00Z" } as CartaoCliente;
    expect(statusDoDrawer(ambos, "financialRelease", false, "2026-10-07")).toMatch(/^Etapa 4 · 3 de \d+ dias úteis$/);
    expect(statusDoDrawer({ ...ambos, agendaCirurgicaLiberadaEm: "2026-10-08T10:00:00Z" }, "financialRelease", false, "2026-10-09")).toBe("Etapa 4 · Agenda cirúrgica liberada");
  });
  it("etapa 5 indica processo concluído", () => {
    expect(statusDoDrawer(base, "surgeryConfirmed", false, "2026-10-10")).toBe("Etapa 5 · Cirurgia confirmada");
    expect(statusDoDrawer(base, "surgeryConfirmed", true, "2026-10-10")).toBe("Etapa 5 · Processo concluído");
  });
});

describe("Jornada: mesma lista do app da cliente", () => {
  it("sempre 8 etapas, com uma única etapa atual durante o processo", () => {
    const passos = passosDaJornada(base, false);
    expect(passos).toHaveLength(8);
    expect(passos.filter((p) => p.status === "current")).toHaveLength(1);
    expect(passos[0].status).toBe("done");
  });
  it("agenda liberada sem data leva a cliente à escolha da data", () => {
    const liberada = { ...base, parcelasPagas: 12, parcelasFaltantes: 0, statusRevisaoFinanceira: "aprovada", custeioStatus: "aprovada", dataTermos: "2026-10-02", comparecimentoStatus: "compareceu", agendaCirurgicaLiberadaEm: "2026-10-08T10:00:00Z" } as CartaoCliente;
    expect(passosDaJornada(liberada, false).find((p) => p.status === "current")?.title).toBe("Escolha da data da cirurgia");
  });
  it("processo concluído marca todas as etapas até a cirurgia", () => {
    const concluida = { ...base, parcelasPagas: 12, parcelasFaltantes: 0, statusRevisaoFinanceira: "aprovada", custeioStatus: "aprovada", dataTermos: "2026-09-28", comparecimentoStatus: "compareceu", agendaCirurgicaLiberadaEm: "2026-10-01T10:00:00Z", dataCirurgia: "2026-10-20", statusCirurgia: "realizada" } as CartaoCliente;
    const passos = passosDaJornada(concluida, true);
    expect(passos.slice(0, 7).every((p) => p.status === "done")).toBe(true);
  });
});

describe("parcelas e histórico do drawer", () => {
  it("status da parcela segue o registro real (suspensa > paga > conferência > rejeitada > vencida)", () => {
    expect(statusParcela({ status: "pago", data_vencimento: "2026-01-01", suspensa: true }, "2026-10-10")).toBe("suspended");
    expect(statusParcela({ status: "pago", data_vencimento: "2026-01-01", suspensa: false }, "2026-10-10")).toBe("paid");
    expect(statusParcela({ status: "pendente_confirmacao", data_vencimento: "2026-01-01", suspensa: false }, "2026-10-10")).toBe("review");
    expect(statusParcela({ status: "rejeitado", data_vencimento: "2026-12-01", suspensa: false }, "2026-10-10")).toBe("rejected");
    expect(statusParcela({ status: "pendente", data_vencimento: "2026-10-09", suspensa: false }, "2026-10-10")).toBe("overdue");
    expect(statusParcela({ status: "pendente", data_vencimento: "2026-10-10", suspensa: false }, "2026-10-10")).toBe("pending");
  });
  it("status do contrato só oferece os valores aceitos pela API", () => {
    expect(STATUS_CLIENTE.map((s) => s.db)).toEqual(["ativo", "suspenso", "negativado", "cancelado"]);
    expect(statusCliente("cancelado").label).toBe("Cancelada");
    expect(statusCliente(undefined).db).toBe("ativo");
  });
  it("histórico descreve a ação e separa o que é financeiro", () => {
    const log = (acao: string, detalhes: Record<string, unknown> = {}) => ({ id: acao, acao, detalhes, usuario: "admin:Amanda", created_at: "2026-10-01T10:00:00Z" }) as unknown as LogAlteracao;
    expect(descreverHistorico(log("baixou_parcela_manual", { parcela: 3, total_parcelas: 12 }))).toEqual({ tipo: "payment", texto: "Pagamento confirmado - Parcela 3/12", autor: "Amanda" });
    expect(descreverHistorico(log("alterou_status_contrato", { para: "suspenso" })).texto).toBe("Status alterado para suspenso");
    expect(ehHistoricoFinanceiro(log("rejeitou_comprovante"))).toBe(true);
    expect(ehHistoricoFinanceiro(log("alterou_status_contrato"))).toBe(false);
  });
});
