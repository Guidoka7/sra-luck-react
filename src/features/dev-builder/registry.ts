import type { BuilderMotionPreset, BuilderNodeKind } from "./types";

export interface BuilderTemplateDefinition {
  id: string;
  kind: BuilderNodeKind;
  label: string;
  version: number;
  description: string;
  slots: string[];
}

export const TEMPLATE_REGISTRY: Record<string, BuilderTemplateDefinition> = {
  "card-classic-01": {
    id: "card-classic-01",
    kind: "card",
    label: "Card Classic 01",
    version: 1,
    description: "Base neutra; aceita composição livre pelo editor.",
    slots: ["eyebrow", "title", "value", "subtitle", "status"],
  },
  "card-premium-02": {
    id: "card-premium-02",
    kind: "card",
    label: "Card Premium 02",
    version: 2,
    description: "Base institucional de maior contraste, sem bloquear posição ou tamanho.",
    slots: ["eyebrow", "title", "value", "subtitle", "status", "cta"],
  },
  "list-dense-01": {
    id: "list-dense-01",
    kind: "list",
    label: "Lista Densa 01",
    version: 1,
    description: "Lista operacional compacta com layout interno configurável.",
    slots: ["title", "items", "cta"],
  },
  "text-heading-01": {
    id: "text-heading-01",
    kind: "text",
    label: "Título 01",
    version: 1,
    description: "Texto sem superfície; ideal para cabeçalhos e saudações.",
    slots: ["title", "subtitle"],
  },
};

export const MOTION_PRESETS: Record<BuilderMotionPreset, { label: string; transform?: string; opacity?: number }> = {
  none: { label: "Nenhuma" },
  fade: { label: "Fade", opacity: 0 },
  "fade-up": { label: "Fade Up", opacity: 0, transform: "translateY(10px)" },
  "scale-soft": { label: "Scale Soft", transform: "scale(.985)" },
  lift: { label: "Lift", transform: "translateY(-3px)" },
};
