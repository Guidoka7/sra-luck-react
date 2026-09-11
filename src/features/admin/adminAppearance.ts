export type AdminPalette = {
  primary: string;
  accent: string;
  highlight: string;
};

export const DEFAULT_ADMIN_PALETTE: AdminPalette = {
  primary: "#7A2632",
  accent: "#B9787F",
  highlight: "#A8834E",
};

const STORAGE_KEY = "sra-luck-admin-palette";
const HEX = /^#[0-9a-f]{6}$/i;

function safeHex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}

export function normalizarPaleta(value?: Partial<AdminPalette> | null): AdminPalette {
  return {
    primary: safeHex(value?.primary, DEFAULT_ADMIN_PALETTE.primary),
    accent: safeHex(value?.accent, DEFAULT_ADMIN_PALETTE.accent),
    highlight: safeHex(value?.highlight, DEFAULT_ADMIN_PALETTE.highlight),
  };
}

export function lerPaletaLocal(): AdminPalette {
  if (typeof window === "undefined") return DEFAULT_ADMIN_PALETTE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ADMIN_PALETTE;
    return normalizarPaleta(JSON.parse(raw) as Partial<AdminPalette>);
  } catch {
    return DEFAULT_ADMIN_PALETTE;
  }
}

export function aplicarPaleta(palette: AdminPalette): void {
  if (typeof document === "undefined") return;
  const p = normalizarPaleta(palette);
  const root = document.documentElement;
  root.style.setProperty("--sl-primary", p.primary);
  root.style.setProperty("--sl-accent", p.accent);
  root.style.setProperty("--sl-highlight", p.highlight);
}

export function salvarPaletaLocal(palette: AdminPalette): AdminPalette {
  const normalized = normalizarPaleta(palette);
  aplicarPaleta(normalized);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch {}
  }
  return normalized;
}

export function paletaDeConfiguracoes(config: Record<string, unknown> | null | undefined): AdminPalette | null {
  if (!config) return null;
  const primary = config.tema_cor_primaria;
  const accent = config.tema_cor_secundaria;
  const highlight = config.tema_cor_destaque;
  if (typeof primary !== "string" && typeof accent !== "string" && typeof highlight !== "string") return null;
  return normalizarPaleta({
    primary: typeof primary === "string" ? primary : undefined,
    accent: typeof accent === "string" ? accent : undefined,
    highlight: typeof highlight === "string" ? highlight : undefined,
  });
}
