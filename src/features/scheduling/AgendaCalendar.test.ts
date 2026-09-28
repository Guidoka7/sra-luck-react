import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgendaCalendar, capacidadeAoLiberar, DayPanel } from "./AgendaCalendar";
import type { DiaCalendario } from "./types";

const calendario: DiaCalendario[] = [
  { id: "d22", data: "2026-09-22", vagasTotais: 2, vagasOcupadas: 1, status: "disponivel" },
  { id: "d23", data: "2026-09-23", vagasTotais: 2, vagasOcupadas: 0, status: "disponivel" },
  { id: "d24", data: "2026-09-24", vagasTotais: 2, vagasOcupadas: 0, status: "disponivel" },
];

describe("AgendaCalendar — datas passadas", () => {
  it("classifica dias anteriores a hoje como encerrados, mesmo que estejam abertos no banco", () => {
    const html = renderToStaticMarkup(createElement(AgendaCalendar, {
      selecionado: "2026-09-23",
      hoje: "2026-09-23",
      calendario,
      onSelecionar: () => {},
      onMudarMes: () => {},
    }));

    expect(html).toContain("ag-dia is-past");
    expect(html).toContain("Selecionar 22/09/2026 (data encerrada)");
    expect(html).toContain("Selecionar 24/09/2026 (disponível)");
  });


  it("libera uma data nova com uma vaga e preserva o ajuste manual quando já está aberta", () => {
    expect(capacidadeAoLiberar(undefined)).toBe(1);
    expect(capacidadeAoLiberar({ id: "bloqueada", data: "2026-09-24", vagasTotais: 4, vagasOcupadas: 0, status: "bloqueado" })).toBe(1);
    expect(capacidadeAoLiberar({ id: "aberta", data: "2026-09-24", vagasTotais: 3, vagasOcupadas: 0, status: "disponivel" })).toBe(3);
    expect(capacidadeAoLiberar({ id: "com-agendamentos", data: "2026-09-24", vagasTotais: 4, vagasOcupadas: 2, status: "bloqueado" })).toBe(2);
  });

  it("data aberta oferece fechar e ajustar vagas; fechada oferece abrir", () => {
    const aberta = renderToStaticMarkup(createElement(DayPanel, {
      tipo: "terms", data: "2026-09-24", hoje: "2026-09-23", dia: calendario[2], ocupado: false,
      itens: [], onAbrir: () => {}, onBloquear: () => {}, onCapacidade: () => {},
    }));
    expect(aberta).toContain("Aberta no app");
    expect(aberta).toContain("Fechar data");
    expect(aberta).toContain('aria-label="Aumentar vagas"');
    expect(aberta).not.toContain("Abrir para assinaturas");

    const fechada = renderToStaticMarkup(createElement(DayPanel, {
      tipo: "terms", data: "2026-09-25", hoje: "2026-09-23", dia: undefined, ocupado: false,
      itens: [], onAbrir: () => {}, onBloquear: () => {}, onCapacidade: () => {},
    }));
    expect(fechada).toContain("Fechada no app");
    expect(fechada).toContain("Abrir para assinaturas");
    expect(fechada).not.toContain('aria-label="Aumentar vagas"');
  });

  it("remove todas as ações de alteração no painel de uma data passada", () => {
    const html = renderToStaticMarkup(createElement(DayPanel, {
      tipo: "surgery",
      data: "2026-09-22",
      hoje: "2026-09-23",
      dia: calendario[0],
      ocupado: false,
      tetoAtingido: false,
      itens: [],
      acaoLista: createElement("button", null, "＋ Nova cirurgia"),
      onAbrir: () => {},
      onBloquear: () => {},
      onCapacidade: () => {},
    }));

    expect(html).toContain("Data encerrada");
    expect(html).toContain("somente para consulta");
    expect(html).not.toContain("Abrir data cirúrgica");
    expect(html).not.toContain("Fechar data");
    expect(html).not.toContain("＋ Nova cirurgia");
    expect(html).not.toContain('aria-label="Aumentar vagas"');
    expect(html).not.toContain('aria-label="Diminuir vagas"');
  });
});
