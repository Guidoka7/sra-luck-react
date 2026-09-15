import type { CSSProperties } from "react";

/**
 * Helpers de estilo transcritos das funções `chip()`/`iconBox()`/`badge()`
 * definidas no <script> de cada .dc.html do ZIP aprovado. Mantidos como
 * funções puras (não componentes) porque o ZIP também os usa assim —
 * cada tela gera o style inline a partir do "kind" semântico do dado real.
 */
export type ZipKind = "ok" | "bad" | "warn" | "rose" | "blue" | "neutral";

const KIND_FG_BG: Record<ZipKind, [string, string]> = {
  ok: ["var(--ok)", "var(--okbg)"],
  bad: ["var(--bad)", "var(--badbg)"],
  warn: ["var(--gold)", "var(--gobg)"],
  rose: ["var(--bg)", "var(--robg)"],
  blue: ["var(--blue)", "var(--bluebg)"],
  neutral: ["var(--soft)", "var(--line2)"],
};

/** Pílula de status (`chip()` no ZIP): altura ~20-21px, texto 8-9px em caixa alta. */
export function zipChip(kind: ZipKind): CSSProperties {
  const [fg, bg] = KIND_FG_BG[kind] ?? KIND_FG_BG.neutral;
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 21,
    padding: "0 8px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: 9,
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

/** Caixa de ícone quadrada (`iconBox()` no ZIP): 24-28px, radius 7-8px. */
export function zipIconBox(kind: ZipKind, size = 28): CSSProperties {
  const [fg, bg] = KIND_FG_BG[kind] ?? KIND_FG_BG.neutral;
  return {
    width: size,
    height: size,
    borderRadius: size >= 28 ? 8 : 7,
    background: bg,
    color: fg,
    display: "grid",
    placeItems: "center",
    fontSize: size >= 28 ? 12 : 10,
    fontWeight: 800,
    flex: "none",
  };
}

/** Painel translúcido com blur (o `--panel`/`--line`/`--sh` recorrente em todo o ZIP). */
export function zipPanel(extra: CSSProperties = {}): CSSProperties {
  return {
    border: "1px solid var(--line)",
    background: "var(--panel)",
    borderRadius: 14,
    boxShadow: "var(--sh)",
    backdropFilter: "blur(18px)",
    ...extra,
  };
}

export function zipStatusDot(kind: ZipKind): CSSProperties {
  const [fg] = KIND_FG_BG[kind] ?? KIND_FG_BG.neutral;
  return { color: fg };
}
