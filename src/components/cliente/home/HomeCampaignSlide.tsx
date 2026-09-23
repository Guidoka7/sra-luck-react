import type { CSSProperties, ReactNode } from "react";
import { HomeCampaignArt } from "./HomeCampaignArt";
import { aplicarContexto, type HomeCampaignContexto, type ResolvedHomeCampaignSlide } from "./homeCampaigns";

interface HomeCampaignSlideProps {
  slide: ResolvedHomeCampaignSlide;
  indexLabel: string;
  priority?: boolean;
  onAction: (slide: ResolvedHomeCampaignSlide) => void;
  suppressTabFocus?: boolean;
  contexto?: HomeCampaignContexto;
}

type PromoStyle = CSSProperties & {
  "--promo-fundo-a": string;
  "--promo-fundo-b": string;
  "--promo-texto": string;
  "--promo-acento": string;
  "--promo-botao": string;
  "--promo-botao-texto": string;
};

/** Título com o trecho de destaque em itálico rosé (padrão do site da marca). */
function tituloComDestaque(titulo: string, destaque?: string): ReactNode {
  if (!destaque) return titulo;
  const i = titulo.lastIndexOf(destaque);
  if (i < 0) return titulo;
  return <>{titulo.slice(0, i)}<em>{destaque}</em>{titulo.slice(i + destaque.length)}</>;
}

export function HomeCampaignSlide({
  slide,
  indexLabel,
  onAction,
  suppressTabFocus = false,
  contexto,
}: HomeCampaignSlideProps) {
  const titulo = aplicarContexto(slide.title, contexto);
  const descricao = aplicarContexto(slide.description, contexto);
  const tema = slide.tema ?? "creme";
  const style: PromoStyle = {
    "--promo-fundo-a": slide.startColor,
    "--promo-fundo-b": slide.backgroundColor === slide.startColor ? slide.endColor : slide.backgroundColor,
    "--promo-texto": slide.textColor,
    "--promo-acento": slide.accentColor,
    "--promo-botao": slide.buttonColor,
    "--promo-botao-texto": slide.buttonTextColor,
  };

  return (
    <article className={`sl-campaign-card sl-promo sl-promo--${tema}`} style={style} aria-label={`${titulo} ${descricao}`}>
      <div className="sl-promo-textura" aria-hidden="true" />
      {slide.arte && <HomeCampaignArt arte={slide.arte} alt={slide.imageAlt} contexto={contexto} />}

      <div className="sl-campaign-content sl-promo-conteudo">
        <div className="sl-campaign-topline">
          <span className="sl-campaign-eyebrow">{slide.eyebrow ?? "Sra. Luck"}</span>
          <span className="sl-campaign-index" aria-hidden="true">{indexLabel}</span>
        </div>

        <div className="sl-campaign-copy">
          <h2>{tituloComDestaque(titulo, slide.destaque ? aplicarContexto(slide.destaque, contexto) : undefined)}</h2>
          <p>{descricao}</p>
        </div>

        <button
          type="button"
          className="sl-campaign-cta"
          tabIndex={suppressTabFocus ? -1 : 0}
          onClick={(event) => {
            event.stopPropagation();
            onAction(slide);
          }}
          aria-label={`${slide.cta}: ${titulo}`}
        >
          <span>{slide.cta}</span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h9M9 4.5 12.5 8 9 11.5" />
          </svg>
        </button>
      </div>
    </article>
  );
}
