import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeCampaignCarousel } from "./HomeCampaignCarousel";

const html = renderToStaticMarkup(createElement(HomeCampaignCarousel, { onAction: () => undefined }));

describe("home campaign carousel markup", () => {
  it("renders the active institutional slides and none of the inactive campaigns", () => {
    expect(html).toContain("Clube de Vantagens");
    expect(html).toContain("Dúvidas? Fale com a gente");
    expect(html).not.toContain("Campanhas especiais");
    expect(html).not.toContain("Isenção de juros e multas");
  });

  it("adds one loop clone on each side, hidden from assistive tech and the tab order", () => {
    const slides = html.match(/aria-roledescription="slide"/g) ?? [];
    expect(slides).toHaveLength(6 + 2);
    const clones = html.match(/aria-hidden="true" class="sl-campaign-slide-wrap"|class="sl-campaign-slide-wrap"[^>]*aria-hidden="true"/g) ?? [];
    expect(clones).toHaveLength(2);
    const ctas = html.match(/<button[^>]*class="sl-campaign-cta"[^>]*>/g) ?? [];
    expect(ctas).toHaveLength(8);
    expect(ctas.filter((b) => b.includes('tabindex="-1"'))).toHaveLength(2);
    expect(ctas.filter((b) => b.includes('tabindex="0"'))).toHaveLength(6);
  });

  it("keeps the final design without navigation arrows", () => {
    expect(html).not.toContain("sl-campaign-arrow");
    expect(html).toContain('aria-roledescription="carrossel"');
  });
});
