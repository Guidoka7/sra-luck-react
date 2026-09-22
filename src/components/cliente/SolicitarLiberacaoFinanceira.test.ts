import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SolicitarLiberacaoFinanceira } from "./SolicitarLiberacaoFinanceira";

const snapshot = (status: string) => ({
  financeiro: { statusCirurgia: null, saldoRestante: 4000, formasCusteio: ["pix"] },
  solicitacaoLiberacaoFinanceira: { id: "s", forma_custeio: "pix", status, observacao: null },
  agendamentoAtivo: { id: "a", data: "2026-09-23", horario: "09:30", dataCirurgia: null },
  agendamentoConcluido: null,
  datasCirurgiaDisponiveis: [],
  agendaCirurgicaLiberada: false,
}) as never;

describe("SolicitarLiberacaoFinanceira — resumos já exibidos no topo da aba Agenda", () => {
  it("oculta o resumo da assinatura e o custeio já confirmado", () => {
    const html = renderToStaticMarkup(createElement(SolicitarLiberacaoFinanceira, { snapshot: snapshot("aprovada"), ocultarResumoAssinatura: true }));
    expect(html).not.toContain("Custeio confirmado");
    expect(html).not.toContain("Horário confirmado:");
  });

  it("mantém a ação de informar/ajustar o custeio quando ainda é necessária", () => {
    const html = renderToStaticMarkup(createElement(SolicitarLiberacaoFinanceira, { snapshot: snapshot("recusada"), ocultarResumoAssinatura: true }));
    expect(html).toContain("Informar");
  });
});
