import type { CSSProperties } from "react";
import { LOGO_SRC } from "@/assets/brand";

/**
 * Logo da tela de login com acabamento: relevo suave, textura acetinada
 * (luz + grão) e um brilho que percorre a marca de tempos em tempos.
 * As camadas usam a própria logo como máscara, então seguem o desenho exato.
 */
export function LogoDestaque({ alt }: { alt: string }) {
  const mascara = { "--sl-logo-mask": `url(${LOGO_SRC})` } as CSSProperties;
  return (
    <div className="sl-logo-hero" style={mascara}>
      <span className="sl-logo-hero__halo" aria-hidden="true" />
      <img src={LOGO_SRC} alt={alt} className="sl-logo-hero__img" width={480} height={152} decoding="sync" />
      <span className="sl-logo-hero__texture" aria-hidden="true" />
      <span className="sl-logo-hero__grain" aria-hidden="true" />
      <span className="sl-logo-hero__sheen" aria-hidden="true" />
    </div>
  );
}
