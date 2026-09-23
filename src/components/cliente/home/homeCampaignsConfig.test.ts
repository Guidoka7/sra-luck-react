import { describe, expect, it } from "vitest";
import { HOME_CAMPAIGN_SLIDES, aplicarConfiguracaoCampanhas, resolveHomeCampaignSlides } from "./homeCampaigns";

describe("carrossel configurável", () => {
  it("sem ajustes, o catálogo é exatamente o padrão", () => {
    expect(aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, [])).toEqual(HOME_CAMPAIGN_SLIDES);
  });

  it("liga/desliga, reordena e troca textos de um cartão existente", () => {
    const slides = aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, [
      { id: "clube-vantagens", ativo: false },
      { id: "seu-plano", ordem: 1, dados: { title: "Novo título", cta: "Ver agora" } },
    ]);
    const resolved = resolveHomeCampaignSlides(slides);
    expect(resolved.find((s) => s.id === "clube-vantagens")).toBeUndefined();
    expect(resolved[0]).toMatchObject({ id: "seu-plano", title: "Novo título", cta: "Ver agora" });
  });

  it("ignora campos e valores fora da lista permitida", () => {
    const [slide] = aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES.slice(0, 1), [
      { id: "nossa-historia", dados: { tema: "neon" as any, action: "campanhas", title: "   " } },
    ]);
    expect(slide).toEqual(HOME_CAMPAIGN_SLIDES[0]);
  });

  it("cartão novo copia o visual do modelo e sempre tem destino navegável", () => {
    const slides = aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, [
      { id: "custom-abc123", baseId: "clube-vantagens", ordem: 5, dados: { title: "Semana do Clube", description: "Pontos em dobro.", cta: "Ver prêmios" } },
    ]);
    const novo = slides.find((s) => s.id === "custom-abc123")!;
    const modelo = HOME_CAMPAIGN_SLIDES.find((s) => s.id === "clube-vantagens")!;
    expect(novo).toMatchObject({ title: "Semana do Clube", backgroundColor: modelo.backgroundColor, availability: "always", active: true, action: "clube" });
    expect(resolveHomeCampaignSlides(slides)[0].id).toBe("custom-abc123");
  });

  it("cartão novo incompleto ou sem modelo é descartado", () => {
    const slides = aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, [
      { id: "custom-sem-modelo", baseId: "nao-existe", dados: { title: "x", description: "y", cta: "z" } },
      { id: "custom-incompleto", baseId: "clube-vantagens", dados: { title: "x" } },
    ]);
    expect(slides).toHaveLength(HOME_CAMPAIGN_SLIDES.length);
  });

  it("campanha comercial continua bloqueada mesmo ligada pelo ajuste", () => {
    const slides = aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, [{ id: "isencao-juros-multas", ativo: true }]);
    expect(resolveHomeCampaignSlides(slides).find((s) => s.id === "isencao-juros-multas")).toBeUndefined();
  });
});
