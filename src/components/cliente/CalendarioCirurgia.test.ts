import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarioCirurgia, deveExibirInformativoAnaliseCusteio } from "./CalendarioCirurgia";

describe("CalendarioCirurgia — aguardando liberação", () => {
  it("mantém o calendário com blur e relógio após a assinatura, sem permitir reservar", () => {
    const html = renderToStaticMarkup(createElement(CalendarioCirurgia, {
      dataAssinatura: "2026-09-22",
      termosAssinados: true,
      formaCusteio: "boleto_100",
    }));
    expect(html).toContain("blur-[4px]");
    expect(html).toContain("M9 5.6V9l2.3 1.5");
    expect(html).toContain("Aguardando liberação");
    expect(html).toContain("Como funciona a liberação?");
    expect(html).toContain("Atualizar status");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Estamos preparando");
    expect(html).not.toContain("Confirmar data");
    const botoes = html.match(/<button[^>]*>/g) ?? [];
    expect(botoes.filter((botao) => !botao.includes('disabled=""'))).toHaveLength(1);
  });

  it("mantém o aviso de que a quitação libera a agenda na etapa anterior à assinatura", () => {
    const html = renderToStaticMarkup(createElement(CalendarioCirurgia, { dataAssinatura: "2026-09-22" }));
    expect(html).toContain("e a quitação do saldo");
    expect(html).not.toContain("Atualizar status");
  });
});


describe("CalendarioCirurgia — informativo por forma de pagamento", () => {
  it("exibe o informativo para 100% boleto e cheques", () => {
    expect(deveExibirInformativoAnaliseCusteio("boleto_100")).toBe(true);
    expect(deveExibirInformativoAnaliseCusteio("cheques")).toBe(true);
  });

  it("não exibe o informativo para PIX, cartão ou forma ainda não definida", () => {
    expect(deveExibirInformativoAnaliseCusteio("pix")).toBe(false);
    expect(deveExibirInformativoAnaliseCusteio("cartao")).toBe(false);
    expect(deveExibirInformativoAnaliseCusteio(null)).toBe(false);

    const pix = renderToStaticMarkup(createElement(CalendarioCirurgia, {
      dataAssinatura: "2026-09-22",
      termosAssinados: true,
      formaCusteio: "pix",
    }));
    expect(pix).not.toContain("Como funciona a liberação?");
    expect(pix).not.toContain("A liberação depende da confirmação da assinatura dos termos");

    const cartao = renderToStaticMarkup(createElement(CalendarioCirurgia, {
      dataAssinatura: "2026-09-22",
      termosAssinados: true,
      formaCusteio: "cartao",
    }));
    expect(cartao).not.toContain("Como funciona a liberação?");
  });
});

describe("CalendarioCirurgia — informativo da liberação (BUSINESS-RULES §12)", () => {
  it("antes da assinatura, explica que a agenda é liberada em até 5 dias úteis após termos + quitação, sem checklist", () => {
    const html = renderToStaticMarkup(createElement(CalendarioCirurgia, { dataAssinatura: "2026-09-22" }));
    expect(html).toContain("Agenda cirúrgica");
    expect(html).toContain("liberada em até 5 dias úteis após a assinatura dos termos e a quitação do saldo");
    expect(html).not.toContain("dias corridos");
    expect(html).not.toContain("Quitação do saldo restante confirmada");
  });

  it("usa a previsão real de liberação quando o backend a informa", () => {
    const snapshot = { agendaCirurgicaLiberarEm: "2026-11-20", agendaCirurgicaLiberada: false, datasCirurgiaDisponiveis: [], financeiro: { statusCirurgia: null, custeioConfirmadoEm: "2026-09-22T10:00:00Z" } } as never;
    const html = renderToStaticMarkup(createElement(CalendarioCirurgia, { dataAssinatura: "2026-09-22", termosAssinados: true, snapshot }));
    expect(html).toContain("Liberação em andamento");
    expect(html).toContain("20/11/2026");
  });
});
