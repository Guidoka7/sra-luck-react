import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgendaHome, deveMostrarEscolhaCusteio, statusAgenda } from "./AgendaHome";

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

describe("AgendaHome — após a assinatura", () => {
  const props = {
    ...base,
    datasDisponiveis: [],
    quantidadeParcelas: 12,
    parcelasPagas: 12,
    liberacaoFinanceiraSolicitada: true,
    confirmando: false,
    onEscolherData: () => {},
  };
  const agendamento = { id: "termos-1", data: "2026-09-21", horario: "10:00", dataCirurgia: null };

  it("avança o cabeçalho com assinatura persistida mesmo enquanto o agendamento está ativo", () => {
    const html = renderToStaticMarkup(createElement(AgendaHome, {
      ...props,
      agendamentoAtivo: { ...agendamento, termosAssinadosEm: "2026-09-22T12:30:00Z" },
    }));
    expect(html).toContain("Agenda cirúrgica");
    expect(html).toContain("22/09/2026 às 09:30");
    expect(html.match(/Termos assinados/g)).toHaveLength(1);
    expect(html).not.toContain("Assinatura dos termos agendada");
    expect(html).not.toContain("Horário confirmado:");
    expect(html).not.toContain("Custeio confirmado");
  });

  it("preserva a confirmação de agendamentos concluídos sem timestamp legado", () => {
    const html = renderToStaticMarkup(createElement(AgendaHome, { ...props, agendamentoConcluido: agendamento }));
    expect(html).toContain("Assinatura confirmada");
    expect(html).toContain("21/09/2026 às 10:00");
    expect(html).toContain("Acompanhe a liberação da agenda");
  });

  it("não trata uma data agendada como assinatura já realizada", () => {
    const html = renderToStaticMarkup(createElement(AgendaHome, { ...props, agendamentoAtivo: agendamento }));
    expect(html).toContain("Assinatura dos termos agendada");
    expect(html).not.toContain("Assinatura confirmada");
  });
});
