import { describe, expect, it } from "vitest";
import { HOME_CAMPAIGN_SLIDES, aplicarContexto, primeiroNome, resolveHomeCampaignNavigation, resolveHomeCampaignSlides } from "./homeCampaigns";

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

describe("campaign-dependent slides need real configuration", () => {
  it("never renders a commercial campaign without campaign config, even if flagged active", () => {
    const flagged = HOME_CAMPAIGN_SLIDES.map((slide) => ({ ...slide, active: true }));
    const ids = resolveHomeCampaignSlides(flagged).map((slide) => slide.id);
    expect(ids).not.toContain("campanhas-especiais");
    expect(ids).not.toContain("isencao-juros-multas");
    expect(resolveHomeCampaignSlides(flagged, { campaignConfigAvailable: true }).map((slide) => slide.id)).toContain("campanhas-especiais");
  });

  it("keeps the initial institutional catalog in order", () => {
    expect(resolveHomeCampaignSlides().map((slide) => slide.id)).toEqual([
      "nossa-historia",
      "clube-vantagens",
      "indique-amiga",
      "seu-plano",
      "acompanhe-jornada",
      "fale-com-a-gente",
    ]);
  });

  it("closes the cycle from the last active slide back to the first", () => {
    const resolved = resolveHomeCampaignSlides();
    const last = resolved[resolved.length - 1];
    expect(last.endColor).toBe(resolved[0].startColor);
    expect(last.wave.endY).toBe(resolved[0].wave.startY);
  });
});

describe("CTA destinations map to the current client app", () => {
  it("routes every active slide to an existing tab or sub-screen", () => {
    const tabs = ["inicio", "agenda", "premios", "parcelas", "mais"];
    for (const slide of resolveHomeCampaignSlides()) {
      const nav = resolveHomeCampaignNavigation(slide.action);
      expect(nav, slide.id).not.toBeNull();
      expect(tabs).toContain(nav!.tab);
    }
  });

  it("uses the existing screens for each destination", () => {
    expect(resolveHomeCampaignNavigation("clube")).toEqual({ tab: "premios" });
    expect(resolveHomeCampaignNavigation("atendimento")).toEqual({ tab: "mais", maisSubTela: "atendimento" });
    expect(resolveHomeCampaignNavigation("parcelas")).toEqual({ tab: "parcelas" });
    expect(resolveHomeCampaignNavigation("jornada")).toEqual({ tab: "mais", maisSubTela: "jornada" });
    expect(resolveHomeCampaignNavigation("notificacoes")).toEqual({ tab: "inicio", openNotifications: true });
    expect(resolveHomeCampaignNavigation("agenda")).toEqual({ tab: "agenda" });
    expect(resolveHomeCampaignNavigation("historia")).toEqual({ tab: "inicio" });
  });

  it("has no runtime for campaigns until a real configuration exists", () => {
    expect(resolveHomeCampaignNavigation("campanhas")).toBeNull();
  });
});

describe("personalização dos cartões", () => {
  it("usa o primeiro nome da cliente e some com a vírgula quando não há nome", () => {
    expect(aplicarContexto("{nome}, acompanhe seus boletos.", { nome: "Maria" })).toBe("Maria, acompanhe seus boletos.");
    expect(aplicarContexto("{nome}, acompanhe seus boletos.", {})).toBe("Acompanhe seus boletos.");
    expect(aplicarContexto("Texto sem nome.", { nome: "Ana" })).toBe("Texto sem nome.");
  });

  it("extrai o primeiro nome com só a inicial maiúscula", () => {
    expect(primeiroNome("MARIA SOUZA")).toBe("Maria");
    expect(primeiroNome("  ana  paula ")).toBe("Ana");
    expect(primeiroNome(null)).toBe("");
  });

  it("todo cartão ativo tem tema, ilustração e destaque contido no título", () => {
    for (const slide of resolveHomeCampaignSlides()) {
      expect(slide.tema, slide.id).toBeTruthy();
      expect(slide.arte, slide.id).toBeTruthy();
      expect(slide.title.includes(slide.destaque ?? ""), slide.id).toBe(true);
    }
  });
});
