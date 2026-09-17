import { describe, expect, it } from "vitest";
import { HOME_CAMPAIGN_SLIDES, resolveHomeCampaignSlides } from "./homeCampaigns";

describe("home campaign catalog", () => {
  it("keeps campaign-dependent offers disabled until a real campaign configuration exists", () => {
    const specialCampaign = HOME_CAMPAIGN_SLIDES.find((slide) => slide.id === "campanhas-especiais");
    const interestWaiver = HOME_CAMPAIGN_SLIDES.find((slide) => slide.id === "isencao-juros-multas");

    expect(specialCampaign?.active).toBe(false);
    expect(specialCampaign?.availability).toBe("requires-campaign-config");
    expect(interestWaiver?.active).toBe(false);
    expect(interestWaiver?.availability).toBe("requires-campaign-config");
  });

  it("sorts active slides by order", () => {
    const resolved = resolveHomeCampaignSlides();
    const orders = resolved.map((slide) => slide.order);

    expect(resolved).toHaveLength(6);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("connects every active slide color and wave to the next one, including the last back to the first", () => {
    const resolved = resolveHomeCampaignSlides();

    resolved.forEach((slide, index) => {
      const next = resolved[(index + 1) % resolved.length];
      expect(slide.endColor).toBe(next.startColor);
      expect(slide.wave.endY).toBe(next.wave.startY);
    });
  });

  it("recalculates continuity when the active selection changes", () => {
    const altered = HOME_CAMPAIGN_SLIDES.map((slide) => ({
      ...slide,
      active: slide.id === "clube-vantagens" || slide.id === "acompanhe-jornada" || slide.id === "fale-com-a-gente",
    }));
    const resolved = resolveHomeCampaignSlides(altered);

    expect(resolved.map((slide) => slide.id)).toEqual([
      "clube-vantagens",
      "acompanhe-jornada",
      "fale-com-a-gente",
    ]);
    expect(resolved[0].endColor).toBe(resolved[1].startColor);
    expect(resolved[1].wave.endY).toBe(resolved[2].wave.startY);
    expect(resolved[2].endColor).toBe(resolved[0].startColor);
  });
});
