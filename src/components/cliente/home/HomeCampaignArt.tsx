import camilaLuck from "@/assets/brand/camila-luck.webp";
import type { HomeCampaignArte, HomeCampaignContexto } from "./homeCampaigns";

/**
 * Ilustrações exclusivas dos cartões da Início, no traço da marca
 * (linhas finas, rosé/vinho/dourado). As cores vêm do tema do cartão
 * (variáveis --promo-* em src/styles/home-promo.css), então cada desenho
 * se adapta ao cartão em que está. Só a foto da fundadora é imagem real.
 */
export function HomeCampaignArt({ arte, alt, contexto }: { arte: HomeCampaignArte; alt?: string; contexto?: HomeCampaignContexto }) {
  if (arte === "camila") {
    return (
      <div className="sl-promo-art sl-promo-art--foto">
        <img src={camilaLuck} alt={alt ?? ""} loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  }
  if (arte === "progresso") {
    const pct = Math.max(0, Math.min(100, Math.round(contexto?.percentualPago ?? 0)));
    const r = 42;
    const c = 2 * Math.PI * r;
    return (
      <div className="sl-promo-art sl-promo-art--anel" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" className="sl-promo-halo" />
          <circle cx="60" cy="60" r={r} className="sl-promo-trilho" />
          <circle cx="60" cy="60" r={r} className="sl-promo-arco" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
          <path d="M60 11.5l1.6 3.4 3.7.5-2.7 2.6.6 3.7-3.2-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" className="sl-promo-estrela" />
        </svg>
        <span className="sl-promo-anel-valor"><b>{pct}%</b><small>do plano pago</small></span>
      </div>
    );
  }
  return (
    <div className="sl-promo-art" aria-hidden="true">
      <svg viewBox="0 0 150 150" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {arte === "clube" && <ArteClube />}
        {arte === "indicacao" && <ArteIndicacao />}
        {arte === "jornada" && <ArteJornada />}
        {arte === "atendimento" && <ArteAtendimento />}
        {arte === "campanha" && <ArteCampanha />}
      </svg>
    </div>
  );
}

function Brilho({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path className="sl-promo-brilho" d={`M${x} ${y - 7 * s}c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6z`} />;
}

function ArteClube() {
  return (
    <>
      <circle cx="78" cy="80" r="58" className="sl-promo-halo" />
      <rect x="40" y="66" width="76" height="56" rx="9" className="sl-promo-forma" />
      <rect x="34" y="52" width="88" height="20" rx="7" className="sl-promo-forma sl-promo-forma--clara" />
      <path d="M78 52v70" className="sl-promo-fita" />
      <path d="M78 52c-6-15-26-19-27-7-1 9 16 9 27 7zM78 52c6-15 26-19 27-7 1 9-16 9-27 7z" className="sl-promo-laco" />
      <circle cx="116" cy="40" r="11" className="sl-promo-moeda" />
      <path d="M116 34.5v11M112.8 37.3c.6-1.6 5.8-1.8 6.2.5.5 2.8-6.6 2.2-6.3 5.1.3 2.3 5.5 2.1 6.4.4" className="sl-promo-moeda-traco" />
      <Brilho x={28} y={38} />
      <Brilho x={126} y={98} s={0.8} />
      <Brilho x={60} y={24} s={0.6} />
    </>
  );
}

function ArteIndicacao() {
  return (
    <>
      <circle cx="75" cy="78" r="58" className="sl-promo-halo" />
      <circle cx="58" cy="62" r="15" className="sl-promo-forma sl-promo-forma--clara" />
      <path d="M31 112c2-17 13-27 27-27s25 10 27 27" className="sl-promo-forma sl-promo-forma--clara" />
      <circle cx="96" cy="70" r="13" className="sl-promo-forma" />
      <path d="M73 116c2-15 11-23 23-23s21 8 23 23" className="sl-promo-forma" />
      <path d="M77 36c-3.5-6-12-4.4-12 2 0 5.5 7.7 9.3 12 13 4.3-3.7 12-7.5 12-13 0-6.4-8.5-8-12-2z" className="sl-promo-coracao" />
      <path d="M115 30v12M109 36h12" className="sl-promo-mais" />
      <Brilho x={28} y={44} s={0.8} />
      <Brilho x={124} y={104} s={0.7} />
    </>
  );
}

function ArteJornada() {
  const pontos: [number, number][] = [[38, 118], [70, 92], [52, 60], [100, 36]];
  return (
    <>
      <circle cx="76" cy="78" r="58" className="sl-promo-halo" />
      <path d="M38 118C58 112 80 104 70 92S40 72 52 60s34-8 48-24" className="sl-promo-caminho" />
      {pontos.slice(0, 3).map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="9" className="sl-promo-forma" />
          <path d={`M${x - 3.6} ${y}l2.6 2.6 5-5.2`} className="sl-promo-check" />
        </g>
      ))}
      <circle cx="100" cy="36" r="13" className="sl-promo-forma sl-promo-forma--clara" />
      <path d="M100 29.5l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" className="sl-promo-estrela" />
      <Brilho x={124} y={70} s={0.7} />
    </>
  );
}

function ArteAtendimento() {
  return (
    <>
      <circle cx="75" cy="78" r="58" className="sl-promo-halo" />
      <path d="M30 50c0-9 7-16 16-16h44c9 0 16 7 16 16v22c0 9-7 16-16 16H60l-16 13v-13h2c-9 0-16-7-16-16z" className="sl-promo-forma sl-promo-forma--clara" />
      <circle cx="54" cy="61" r="3" className="sl-promo-ponto" />
      <circle cx="68" cy="61" r="3" className="sl-promo-ponto" />
      <circle cx="82" cy="61" r="3" className="sl-promo-ponto" />
      <path d="M72 96c0-7.7 6.3-14 14-14h26c7.7 0 14 6.3 14 14v12c0 7.7-6.3 14-14 14h-2v11l-13-11H86c-7.7 0-14-6.3-14-14z" className="sl-promo-forma" />
      <path d="M99 99.5c-2.4-4-8-3-8 1.3 0 3.7 5.1 6.2 8 8.7 2.9-2.5 8-5 8-8.7 0-4.3-5.6-5.3-8-1.3z" className="sl-promo-coracao" />
      <Brilho x={120} y={40} s={0.8} />
    </>
  );
}

function ArteCampanha() {
  return (
    <>
      <circle cx="75" cy="78" r="58" className="sl-promo-halo" />
      <path d="M44 56l62-14v70l-62-14z" className="sl-promo-forma sl-promo-forma--clara" />
      <rect x="30" y="56" width="16" height="42" rx="5" className="sl-promo-forma" />
      <path d="M50 98l6 22h12l-5-18" className="sl-promo-forma" />
      <Brilho x={120} y={48} />
      <Brilho x={124} y={104} s={0.7} />
    </>
  );
}
