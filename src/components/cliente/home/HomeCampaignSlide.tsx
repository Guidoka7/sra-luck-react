import { useState, type CSSProperties } from "react";
import type { ResolvedHomeCampaignSlide } from "./homeCampaigns";

interface HomeCampaignSlideProps {
  slide: ResolvedHomeCampaignSlide;
  indexLabel: string;
  priority?: boolean;
  onAction: (slide: ResolvedHomeCampaignSlide) => void;
  suppressAction?: boolean;
}

type CampaignStyle = CSSProperties & {
  "--sl-campaign-start": string;
  "--sl-campaign-end": string;
  "--sl-campaign-accent": string;
  "--sl-campaign-text": string;
  "--sl-campaign-button": string;
  "--sl-campaign-button-text": string;
  "--sl-campaign-wave": string;
  "--sl-campaign-wave-opacity": string;
  "--sl-campaign-object-mobile": string;
  "--sl-campaign-object-desktop": string;
};

function resolveImage(slide: ResolvedHomeCampaignSlide) {
  return slide.mobileImage ?? slide.desktopImage ?? slide.backgroundImage ?? null;
}

export function HomeCampaignSlide({
  slide,
  indexLabel,
  priority = false,
  onAction,
  suppressAction = false,
}: HomeCampaignSlideProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = resolveImage(slide);
  const background = slide.backgroundGradient ?? `linear-gradient(112deg, ${slide.startColor} 0%, ${slide.endColor} 100%)`;
  const style: CampaignStyle = {
    backgroundColor: slide.backgroundColor,
    backgroundImage: background,
    color: slide.textColor,
    "--sl-campaign-start": slide.startColor,
    "--sl-campaign-end": slide.endColor,
    "--sl-campaign-accent": slide.accentColor,
    "--sl-campaign-text": slide.textColor,
    "--sl-campaign-button": slide.buttonColor,
    "--sl-campaign-button-text": slide.buttonTextColor,
    "--sl-campaign-wave": slide.wave.color ?? "rgba(255,255,255,.8)",
    "--sl-campaign-wave-opacity": String(slide.wave.opacity ?? 0.28),
    "--sl-campaign-object-mobile": slide.objectPositionMobile ?? "50% 50%",
    "--sl-campaign-object-desktop": slide.objectPositionDesktop ?? slide.objectPositionMobile ?? "50% 50%",
  };

  const wavePath = `M -2 ${slide.wave.startY} C 22 ${slide.wave.startY - 17}, 68 ${slide.wave.endY + 17}, 102 ${slide.wave.endY}`;
  const waveFillPath = `${wavePath} L 102 108 L -2 108 Z`;

  return (
    <article className="sl-campaign-card" style={style} aria-label={`${slide.title}. ${slide.description}`}>
      {imageSrc && !imageFailed && (
        <picture className="sl-campaign-art" aria-hidden="true">
          {slide.desktopImage && <source media="(min-width: 768px)" srcSet={slide.desktopImage} />}
          <img
            src={imageSrc}
            alt={slide.imageAlt ?? ""}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            draggable={false}
            onError={() => setImageFailed(true)}
          />
        </picture>
      )}

      <div
        className="sl-campaign-overlay"
        aria-hidden="true"
        style={{ backgroundImage: slide.overlay, opacity: slide.overlayOpacity ?? 1 }}
      />

      <svg
        className="sl-campaign-wave"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path className="sl-campaign-wave-fill" d={waveFillPath} />
        <path className="sl-campaign-wave-line sl-campaign-wave-line-soft" d={wavePath} pathLength="100" />
        <path className="sl-campaign-wave-line" d={wavePath} pathLength="100" />
      </svg>

      <div className="sl-campaign-orb sl-campaign-orb-a" aria-hidden="true" />
      <div className="sl-campaign-orb sl-campaign-orb-b" aria-hidden="true" />

      <div className="sl-campaign-content">
        <div className="sl-campaign-topline">
          <span className="sl-campaign-eyebrow">{slide.eyebrow ?? "Sra. Luck"}</span>
          <span className="sl-campaign-index" aria-hidden="true">{indexLabel}</span>
        </div>

        <div className="sl-campaign-copy">
          <h2>{slide.title}</h2>
          <p>{slide.description}</p>
        </div>

        <button
          type="button"
          className="sl-campaign-cta"
          onClick={(event) => {
            event.stopPropagation();
            if (!suppressAction) onAction(slide);
          }}
          aria-label={`${slide.cta}: ${slide.title}`}
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
