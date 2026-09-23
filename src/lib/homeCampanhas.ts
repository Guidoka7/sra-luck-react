import { useEffect, useState } from "react";
import {
  HOME_CAMPAIGN_SLIDES,
  aplicarConfiguracaoCampanhas,
  type HomeCampaignOverride,
  type HomeCampaignSlideConfig,
} from "@/components/cliente/home/homeCampaigns";

const CACHE_KEY = "sra_luck_home_campanhas_ajustes";

function lerCache(): HomeCampaignOverride[] {
  try {
    const valor = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    return Array.isArray(valor) ? valor : [];
  } catch {
    return [];
  }
}

/**
 * Cartões do carrossel da Início: catálogo padrão + ajustes do Admin.
 * Mostra na hora o último ajuste conhecido (sem "piscar") e atualiza em
 * segundo plano. Qualquer falha mantém o catálogo padrão.
 */
export function useHomeCampaignSlides(): HomeCampaignSlideConfig[] {
  const [slides, setSlides] = useState<HomeCampaignSlideConfig[]>(() => aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, lerCache()));

  useEffect(() => {
    let ativo = true;
    fetch("/api/cliente/home-campanhas", { credentials: "include", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ajustes?: HomeCampaignOverride[] } | null) => {
        if (!ativo || !Array.isArray(data?.ajustes)) return;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data!.ajustes)); } catch { /* armazenamento indisponível */ }
        setSlides(aplicarConfiguracaoCampanhas(HOME_CAMPAIGN_SLIDES, data!.ajustes));
      })
      .catch(() => undefined);
    return () => { ativo = false; };
  }, []);

  return slides;
}
