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

  it("preserva o aviso de quitação para a etapa anterior à assinatura", () => {
    const html = renderToStaticMarkup(createElement(CalendarioCirurgia, { dataAssinatura: "2026-09-22" }));
    expect(html).toContain("A quitação do saldo precisa ser confirmada");
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
