// Interior style presets: the default finish of every material role, so a
// whole room reads as one scheme. A per-item `finish` word overrides its main
// material; everything else follows the room's style.

import type { FloorFinish, StyleId } from "./types";

export type WoodSpecies = "oak" | "walnut" | "teak" | "white-oak" | "ash" | "wenge";
export type MetalKind = "brass" | "black" | "steel" | "gold";
export type StoneKind = "white-marble" | "grey-marble" | "beige-marble" | "black-marble";

export interface Palette {
  label: string;
  /** One line used in AI prompts. */
  describe: string;
  wood: WoodSpecies;
  /** Second wood for accents (side tables, frames). */
  woodAccent: WoodSpecies;
  fabric: string;
  /** Throw cushions, throws, accent chairs. */
  accent: string;
  accent2: string;
  bedding: string;
  lacquer: string;
  metal: MetalKind;
  stone: StoneKind;
  wall: string;
  floor: FloorFinish;
  rug: [string, string, string];
  leather: string;
}

export const STYLES: Record<StyleId, Palette> = {
  "modern-warm": {
    label: "Modern warm",
    describe: "modern warm interior, walnut and oak woods, oat and beige linen, brass accents, warm white walls",
    wood: "walnut",
    woodAccent: "oak",
    fabric: "#cdbfa8",
    accent: "#b5714d",
    accent2: "#6f7a63",
    bedding: "#f1ece3",
    lacquer: "#e8e2d6",
    metal: "brass",
    stone: "beige-marble",
    wall: "#ece6dc",
    floor: "wood",
    rug: ["#d9cdb8", "#9b6b4e", "#f2ece2"],
    leather: "#8a5a3c",
  },
  scandinavian: {
    label: "Scandinavian",
    describe: "Scandinavian interior, light oak, white and light grey textiles, black metal details, bright and airy",
    wood: "white-oak",
    woodAccent: "oak",
    fabric: "#c9c9c4",
    accent: "#7c8a7a",
    accent2: "#d8c3a5",
    bedding: "#f6f5f2",
    lacquer: "#f3f2ee",
    metal: "black",
    stone: "white-marble",
    wall: "#f2f1ed",
    floor: "wood",
    rug: ["#e7e4dd", "#8f8f8a", "#ffffff"],
    leather: "#a87a52",
  },
  luxury: {
    label: "Luxury",
    describe: "luxury contemporary interior, dark walnut, charcoal and taupe velvet, book-matched marble, gold trims",
    wood: "wenge",
    woodAccent: "walnut",
    fabric: "#5f5a55",
    accent: "#a9895a",
    accent2: "#2f3e46",
    bedding: "#ebe6de",
    lacquer: "#3a3633",
    metal: "gold",
    stone: "white-marble",
    wall: "#d9d2c7",
    floor: "marble",
    rug: ["#8c8279", "#3c3835", "#c9b38a"],
    leather: "#4a3228",
  },
  minimal: {
    label: "Minimal",
    describe: "minimal interior, white lacquer, pale ash wood, soft grey and oat textiles, clean lines",
    wood: "ash",
    woodAccent: "white-oak",
    fabric: "#d6d1c7",
    accent: "#9aa39b",
    accent2: "#c6b59b",
    bedding: "#fafaf8",
    lacquer: "#f4f3f0",
    metal: "steel",
    stone: "white-marble",
    wall: "#f4f3ef",
    floor: "tile",
    rug: ["#e9e6df", "#b9b4aa", "#ffffff"],
    leather: "#b08b67",
  },
  "indian-contemporary": {
    label: "Indian contemporary",
    describe: "Indian contemporary interior, teak wood, cane and rattan details, mustard, terracotta and teal accents, warm lighting",
    wood: "teak",
    woodAccent: "walnut",
    fabric: "#d8c7a5",
    accent: "#c98a2b",
    accent2: "#2f6f6b",
    bedding: "#f4ede1",
    lacquer: "#efe6d4",
    metal: "brass",
    stone: "beige-marble",
    wall: "#efe5d4",
    floor: "tile",
    rug: ["#b5542f", "#1f4e5f", "#e9d8b6"],
    leather: "#7a4a2a",
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

/** Named colours a user can say in a command ("make the sofa sage green"). */
export const COLOR_WORDS: Record<string, string> = {
  white: "#f2f0eb",
  "off white": "#ece7dd",
  ivory: "#efe8d8",
  cream: "#ebe0c9",
  beige: "#d8c8ad",
  oat: "#d4c6ad",
  sand: "#d2bf9c",
  taupe: "#8b7d70",
  grey: "#9b9a96",
  gray: "#9b9a96",
  "light grey": "#c8c7c3",
  "dark grey": "#55534f",
  charcoal: "#3e3d3b",
  black: "#232221",
  navy: "#273a55",
  blue: "#3e5f86",
  "powder blue": "#a9bccc",
  teal: "#2f6f6b",
  green: "#4d6b4a",
  "sage green": "#9aa58b",
  sage: "#9aa58b",
  olive: "#6b6b3e",
  "emerald green": "#1f5f4a",
  emerald: "#1f5f4a",
  mustard: "#c98f2b",
  yellow: "#d9b44a",
  terracotta: "#b5603d",
  rust: "#a24e2c",
  orange: "#c9733a",
  pink: "#d9a3a0",
  blush: "#e3bdb3",
  red: "#9b2f2f",
  maroon: "#6e2430",
  burgundy: "#6b2433",
  brown: "#6b4a33",
  chocolate: "#4a3227",
  tan: "#b48a62",
  camel: "#b3854f",
  lavender: "#b6a9c9",
  purple: "#5d4570",
};

export const WOOD_WORDS: Record<string, WoodSpecies> = {
  oak: "oak",
  "light oak": "white-oak",
  "white oak": "white-oak",
  walnut: "walnut",
  "dark walnut": "wenge",
  teak: "teak",
  ash: "ash",
  wenge: "wenge",
  "dark wood": "wenge",
  "light wood": "white-oak",
  wooden: "oak",
  wood: "oak",
};
