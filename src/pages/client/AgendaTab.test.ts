import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgendaTab } from "./AgendaTab";
import { deveMostrarEscolhaCusteio, etapaAgenda, passoDaTrilha, statusAgenda } from "@/components/cliente/agenda/agendaEtapa";

const base = {
  agendamentoAtivo: null,
  agendamentoConcluido: null,
  podeAgendar: true,
  agendaLiberada: false,
  statusRevisaoFinanceira: "aprovada" as const,
  custeioAprovado: false,
};

describe("AgendaTab — transição para Etapa 3", () => {
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

describe("AgendaTab — após a assinatura", () => {
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
    const html = renderToStaticMarkup(createElement(AgendaTab, {
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
    const html = renderToStaticMarkup(createElement(AgendaTab, { ...props, agendamentoConcluido: agendamento }));
    expect(html).toContain("Assinatura confirmada");
    expect(html).toContain("21/09/2026 às 10:00");
    expect(html).toContain("Acompanhe a liberação da agenda");
  });

  it("não trata uma data agendada como assinatura já realizada", () => {
    const html = renderToStaticMarkup(createElement(AgendaTab, { ...props, agendamentoAtivo: agendamento }));
    expect(html).toContain("Assinatura dos termos agendada");
    expect(html).not.toContain("Assinatura confirmada");
  });
});

describe("AgendaTab — cirurgia confirmada", () => {
  it.each(["agendamentoAtivo", "agendamentoConcluido"] as const)("mostra somente a cirurgia registrada em %s", (campo) => {
    const html = renderToStaticMarkup(createElement(AgendaTab, {
      ...base,
      datasDisponiveis: [],
      quantidadeParcelas: 12,
      parcelasPagas: 12,
      liberacaoFinanceiraSolicitada: true,
      confirmando: false,
      onEscolherData: () => {},
      [campo]: { id: "termos-1", data: "2026-09-22", horario: "09:30", dataCirurgia: "2026-09-23", termosAssinadosEm: "2026-09-22T12:30:00Z" },
    }));
    expect(html).toContain("Seu grande dia já tem data!");
    expect(html).toContain("Cirurgia confirmada");
    expect(html).toMatch(/datetime="2026-09-23"/i);
    expect(html).toContain("23 de setembro de 2026");
    expect(html).not.toContain("Termos assinados");
    expect(html).not.toContain("Assinatura confirmada");
    expect(html).not.toContain("09:30");
    expect(html).not.toContain("2026-09-22");
    expect(html).not.toContain("Alterar data");
    expect(html).not.toContain("<button");
  });
});

describe("AgendaTab — etapa atual do fluxo", () => {
  const estado = { ...base, liberacaoFinanceiraSolicitada: false };
  it("segue a ordem real do fluxo até a cirurgia", () => {
    expect(etapaAgenda({ ...estado, podeAgendar: false, statusRevisaoFinanceira: null })).toBe("percentual");
    expect(etapaAgenda({ ...estado, statusRevisaoFinanceira: null })).toBe("elegivel");
    expect(etapaAgenda({ ...estado, statusRevisaoFinanceira: "pendente", liberacaoFinanceiraSolicitada: true })).toBe("levantamento");
    expect(etapaAgenda({ ...estado, statusRevisaoFinanceira: "recusada" })).toBe("ajuste");
    expect(etapaAgenda(estado)).toBe("pagamento");
    expect(etapaAgenda({ ...estado, custeioAprovado: true })).toBe("custeio_analise");
    expect(etapaAgenda({ ...estado, custeioAprovado: true, agendaLiberada: true })).toBe("data");
    const agendamento = { id: "a", data: "2026-10-01", horario: "10:00", dataCirurgia: null };
    expect(etapaAgenda({ ...estado, agendamentoAtivo: agendamento })).toBe("termos_agendados");
    expect(etapaAgenda({ ...estado, agendamentoConcluido: agendamento })).toBe("termos_assinados");
    expect(etapaAgenda({ ...estado, agendamentoConcluido: { ...agendamento, dataCirurgia: "2026-11-01" } })).toBe("cirurgia");
  });

  it("marca a trilha no passo correspondente", () => {
    expect(passoDaTrilha("percentual")).toBe(0);
    expect(passoDaTrilha("custeio_analise")).toBe(2);
    expect(passoDaTrilha("termos_agendados")).toBe(3);
    expect(passoDaTrilha("cirurgia")).toBe(5);
  });

  it("oferece o atalho para a forma de pagamento na etapa 3", () => {
    const html = renderToStaticMarkup(createElement(AgendaTab, {
      ...base, datasDisponiveis: [], quantidadeParcelas: 12, parcelasPagas: 8, liberacaoFinanceiraSolicitada: true, confirmando: false, onEscolherData: () => {},
    }));
    expect(html).toContain("Escolher forma de pagamento");
  });
});
