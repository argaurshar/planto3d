import type { DesignBrief } from "./types";

/**
 * Interior-design style presets. Each preset carries a short `descriptor` that
 * is injected into both the prompt-writer (Stage 3a) and the renderers so the
 * whole project shares a coherent look.
 */
export interface StylePreset {
  id: string;
  label: string;
  descriptor: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "luxury-coastal-modern",
    label: "Luxury coastal modern",
    descriptor:
      "luxury coastal modern: warm European oak timber floors, neutral linen and stone tones, soft natural light, airy open spaces, high-end contemporary furniture",
  },
  {
    id: "scandinavian-japandi",
    label: "Scandinavian / Japandi",
    descriptor:
      "Scandinavian Japandi: light woods, muted neutral palette, minimal clutter, soft textiles, clean lines, calm and functional",
  },
  {
    id: "minimalist-warm",
    label: "Minimalist warm",
    descriptor:
      "warm minimalist: off-white and beige palette, microcement and natural wood, few but refined pieces, diffuse soft lighting",
  },
  {
    id: "industrial",
    label: "Industrial",
    descriptor:
      "industrial: exposed brick and concrete, blackened steel, reclaimed wood, Edison lighting, raw textural surfaces",
  },
  {
    id: "mid-century",
    label: "Mid-century modern",
    descriptor:
      "mid-century modern: walnut wood, tapered legs, warm mustard and teal accents, geometric forms, retro lighting",
  },
  {
    id: "contemporary-luxe",
    label: "Contemporary luxe",
    descriptor:
      "contemporary luxe: polished marble, brass accents, deep velvets, statement lighting, refined high-contrast palette",
  },
  { id: "custom", label: "Custom (describe below)", descriptor: "" },
];

export const DEFAULT_BRIEF: DesignBrief = {
  styleId: "luxury-coastal-modern",
  customStyle: "",
  lighting: "natural afternoon light from the east",
};

export function getPreset(styleId: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === styleId);
}

/**
 * Resolve a brief into a single human-readable style descriptor for prompts.
 * Combines the preset descriptor with any custom text the user added.
 */
export function resolveStyleDescriptor(brief: DesignBrief): string {
  const preset = getPreset(brief.styleId);
  const custom = brief.customStyle?.trim();
  if (brief.styleId === "custom") {
    return custom || "clean modern interior design";
  }
  const base = preset?.descriptor || preset?.label || "modern interior";
  return custom ? `${base}; additional notes: ${custom}` : base;
}

/** Short label for UI display. */
export function styleLabel(brief: DesignBrief): string {
  if (brief.styleId === "custom") {
    return brief.customStyle?.trim() || "Custom";
  }
  return getPreset(brief.styleId)?.label || "Custom";
}
