// What every piece of furniture is: its name and the words people use for it
// (for commands and for plan reading), a standard size, a plausible size range
// (detection boxes are clamped into it), how it sits in a room, and the designs
// it can be built in. Sizes are in metres; widths are as you face the piece.

import type { ItemType, RoomKind } from "./types";

export interface Variant {
  id: string;
  label: string;
}

/** What the main material of a piece is, so a finish word can restyle it. */
export type MaterialRole = "wood" | "fabric" | "lacquer" | "stone" | "metal" | "ceramic" | "plant" | "none";

export interface CatalogEntry {
  label: string;
  /** Words that mean this item, most specific first. Matched as whole words. */
  aliases: string[];
  size: { w: number; d: number; h: number };
  range: { w: [number, number]; d: [number, number] };
  /** Its back goes against a wall (bed head, wardrobe, sofa back…). */
  againstWall: boolean;
  /** Hung on a wall rather than standing on the floor (bed back panel, artwork). */
  wallMounted?: boolean;
  /** Lies flat on the floor (rug). */
  flat?: boolean;
  /** Hangs from the ceiling (fan): its footprint is not on the floor, its `h` is the drop. */
  ceilingMounted?: boolean;
  role: MaterialRole;
  variants: Variant[];
}

export const CATALOG: Record<ItemType, CatalogEntry> = {
  bed: {
    label: "bed",
    aliases: ["king size bed", "queen size bed", "double bed", "single bed", "bed", "cot"],
    size: { w: 1.8, d: 2.1, h: 1.15 },
    range: { w: [0.95, 2.1], d: [1.95, 2.3] },
    againstWall: true,
    role: "fabric",
    variants: [
      { id: "upholstered", label: "Upholstered channel headboard" },
      { id: "wingback", label: "Wingback" },
      { id: "wooden", label: "Solid wood" },
      { id: "storage", label: "Hydraulic storage box bed" },
      { id: "platform", label: "Low platform with side shelves" },
    ],
  },
  bedBack: {
    label: "bed back panel",
    aliases: ["bed back panel", "bed back", "bedback", "headboard wall", "headboard panel", "back panel behind bed", "wall panel behind bed"],
    size: { w: 3.2, d: 0.06, h: 2.4 },
    range: { w: [1.4, 6], d: [0.03, 0.15] },
    againstWall: true,
    wallMounted: true,
    role: "wood",
    variants: [
      { id: "fluted", label: "Fluted wood" },
      { id: "upholstered-grid", label: "Upholstered grid + veneer" },
      { id: "veneer-led", label: "Veneer with LED grooves" },
      { id: "marble", label: "Book-matched marble" },
      { id: "moulding", label: "Painted wall moulding" },
    ],
  },
  nightstand: {
    label: "side table",
    aliases: ["bedside table", "bed side table", "side table", "nightstand", "night stand", "bedside"],
    size: { w: 0.5, d: 0.42, h: 0.5 },
    range: { w: [0.35, 0.8], d: [0.3, 0.55] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "two-drawer", label: "Two drawers" },
      { id: "open-shelf", label: "Open shelf" },
      { id: "round", label: "Round pedestal" },
      { id: "floating", label: "Floating (wall hung)" },
      { id: "cane", label: "Cane front" },
    ],
  },
  wardrobe: {
    label: "wardrobe",
    aliases: ["wardrobe", "almirah", "closet", "cupboard", "cabinet wardrobe"],
    size: { w: 1.8, d: 0.6, h: 2.1 },
    range: { w: [0.9, 4.5], d: [0.5, 0.7] },
    againstWall: true,
    role: "lacquer",
    variants: [
      { id: "hinged", label: "Hinged shutters" },
      { id: "sliding", label: "Sliding doors" },
      { id: "hinged-loft", label: "Hinged with loft to ceiling" },
      { id: "glass", label: "Fluted glass + aluminium" },
    ],
  },
  dresser: {
    label: "dressing unit",
    aliases: ["dressing table", "dressing unit", "dresser", "vanity table", "chest of drawers"],
    size: { w: 1.0, d: 0.45, h: 0.78 },
    range: { w: [0.6, 1.8], d: [0.35, 0.6] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "mirror-console", label: "Console with mirror" },
      { id: "chest", label: "Chest of drawers" },
    ],
  },
  tvUnit: {
    label: "TV unit",
    aliases: ["tv unit", "tv panel", "tv wall", "tv cabinet", "media unit", "entertainment unit", "television", "tv"],
    size: { w: 2.0, d: 0.42, h: 0.45 },
    range: { w: [1.2, 4.5], d: [0.3, 0.55] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "floating", label: "Floating console" },
      { id: "panel", label: "Full wall panel with shelves" },
      { id: "low", label: "Low sideboard on legs" },
    ],
  },
  sofa: {
    label: "sofa",
    aliases: ["l shaped sofa", "l shape sofa", "sectional sofa", "sofa set", "sofa", "couch", "settee"],
    size: { w: 2.2, d: 0.95, h: 0.82 },
    range: { w: [1.4, 3.6], d: [0.8, 2.0] },
    againstWall: true,
    role: "fabric",
    variants: [
      { id: "three-seater", label: "Three seater" },
      { id: "l-shape", label: "L-shape with chaise" },
      { id: "chesterfield", label: "Chesterfield" },
      { id: "modular", label: "Low modular" },
    ],
  },
  armchair: {
    label: "armchair",
    aliases: ["accent chair", "lounge chair", "arm chair", "armchair", "wing chair", "easy chair"],
    size: { w: 0.8, d: 0.82, h: 0.85 },
    range: { w: [0.6, 1.1], d: [0.6, 1.0] },
    againstWall: false,
    role: "fabric",
    variants: [
      { id: "lounge", label: "Lounge" },
      { id: "wing", label: "Wing chair" },
      { id: "wooden", label: "Wooden frame" },
    ],
  },
  coffeeTable: {
    label: "coffee table",
    aliases: ["centre table", "center table", "coffee table", "tea table"],
    size: { w: 1.1, d: 0.6, h: 0.4 },
    range: { w: [0.5, 1.6], d: [0.45, 1.0] },
    againstWall: false,
    role: "wood",
    variants: [
      { id: "rectangular", label: "Wooden rectangle" },
      { id: "round-marble", label: "Round marble" },
      { id: "nesting", label: "Nesting pair" },
    ],
  },
  sideTable: {
    label: "end table",
    aliases: ["end table", "corner table", "accent table", "lamp table"],
    size: { w: 0.45, d: 0.45, h: 0.55 },
    range: { w: [0.3, 0.7], d: [0.3, 0.7] },
    againstWall: false,
    role: "wood",
    variants: [
      { id: "round", label: "Round pedestal" },
      { id: "open-shelf", label: "Open shelf" },
    ],
  },
  ottoman: {
    label: "pouf",
    aliases: ["ottoman", "pouf", "pouffe", "footstool"],
    size: { w: 0.5, d: 0.5, h: 0.42 },
    range: { w: [0.35, 1.0], d: [0.35, 1.0] },
    againstWall: false,
    role: "fabric",
    variants: [
      { id: "round", label: "Round" },
      { id: "square", label: "Square" },
    ],
  },
  diningSet: {
    label: "dining set",
    aliases: ["dining table", "dining set", "dinner table", "dining"],
    size: { w: 1.6, d: 0.9, h: 0.75 },
    range: { w: [0.8, 3.0], d: [0.75, 1.3] },
    againstWall: false,
    role: "wood",
    variants: [
      { id: "rectangular", label: "Rectangular with chairs" },
      { id: "round", label: "Round with chairs" },
      { id: "marble", label: "Marble top with chairs" },
    ],
  },
  desk: {
    label: "study table",
    aliases: ["study table", "study desk", "work desk", "writing desk", "computer table", "desk"],
    size: { w: 1.2, d: 0.6, h: 0.75 },
    range: { w: [0.8, 2.4], d: [0.45, 0.8] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "writing", label: "Writing desk with chair" },
      { id: "shelves", label: "Desk with wall shelves" },
    ],
  },
  chair: {
    label: "chair",
    aliases: ["office chair", "study chair", "dining chair", "chair", "stool"],
    size: { w: 0.5, d: 0.52, h: 0.85 },
    range: { w: [0.4, 0.7], d: [0.4, 0.7] },
    againstWall: false,
    role: "wood",
    variants: [
      { id: "dining", label: "Dining chair" },
      { id: "office", label: "Office chair" },
    ],
  },
  bookshelf: {
    label: "bookshelf",
    aliases: ["book shelf", "bookshelf", "bookcase", "shelf unit", "shelves", "shelf"],
    size: { w: 1.0, d: 0.35, h: 2.0 },
    range: { w: [0.5, 3.0], d: [0.25, 0.45] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "open", label: "Open shelves with books" },
      { id: "closed", label: "With lower doors" },
    ],
  },
  sideboard: {
    label: "sideboard",
    aliases: ["crockery unit", "sideboard", "console table", "console", "cabinet", "shoe rack", "storage unit"],
    size: { w: 1.4, d: 0.45, h: 0.8 },
    range: { w: [0.6, 3.0], d: [0.3, 0.6] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "doors", label: "Doors and legs" },
      { id: "cane", label: "Cane shutters" },
    ],
  },
  rug: {
    label: "rug",
    aliases: ["carpet", "rug", "dhurrie", "mat"],
    size: { w: 2.0, d: 1.4, h: 0.012 },
    range: { w: [0.8, 4.0], d: [0.6, 3.5] },
    againstWall: false,
    flat: true,
    role: "fabric",
    variants: [
      { id: "patterned", label: "Patterned border" },
      { id: "plain", label: "Plain wool" },
      { id: "round", label: "Round" },
    ],
  },
  plant: {
    label: "plant",
    aliases: ["indoor plant", "planter", "plant", "tree"],
    size: { w: 0.5, d: 0.5, h: 1.5 },
    range: { w: [0.3, 1.0], d: [0.3, 1.0] },
    againstWall: false,
    role: "plant",
    variants: [
      { id: "tall", label: "Tall fiddle leaf" },
      { id: "bush", label: "Low bush" },
    ],
  },
  floorLamp: {
    label: "floor lamp",
    aliases: ["floor lamp", "standing lamp", "lamp"],
    size: { w: 0.4, d: 0.4, h: 1.6 },
    range: { w: [0.25, 0.6], d: [0.25, 0.6] },
    againstWall: false,
    role: "metal",
    variants: [
      { id: "drum", label: "Drum shade" },
      { id: "arc", label: "Arc" },
    ],
  },
  artwork: {
    label: "wall art",
    aliases: ["painting", "wall art", "artwork", "art", "frame", "wall painting"],
    size: { w: 1.0, d: 0.04, h: 0.7 },
    range: { w: [0.3, 2.5], d: [0.02, 0.08] },
    againstWall: true,
    wallMounted: true,
    role: "none",
    variants: [
      { id: "abstract", label: "Abstract canvas" },
      { id: "triptych", label: "Set of three" },
    ],
  },
  mirror: {
    label: "mirror",
    aliases: ["full length mirror", "mirror"],
    size: { w: 0.7, d: 0.03, h: 1.0 },
    range: { w: [0.3, 2.0], d: [0.02, 0.06] },
    againstWall: true,
    wallMounted: true,
    role: "metal",
    variants: [
      { id: "arched", label: "Arched" },
      { id: "round", label: "Round" },
      { id: "rect", label: "Rectangle" },
    ],
  },
  ceilingFan: {
    label: "ceiling fan",
    aliases: ["ceiling fan", "fan"],
    size: { w: 1.2, d: 1.2, h: 0.42 },
    range: { w: [0.6, 1.6], d: [0.6, 1.6] },
    againstWall: false,
    ceilingMounted: true,
    role: "lacquer",
    variants: [
      { id: "classic", label: "Three blades on a downrod" },
      { id: "wood", label: "Four wooden blades" },
      { id: "light", label: "Flush, with a light" },
    ],
  },
  ac: {
    label: "split AC",
    aliases: ["split ac", "split a.c.", "air conditioner", "air conditioning", "airconditioner", "aircon", "ac unit", "ac", "a.c.", "a.c"],
    size: { w: 1.0, d: 0.24, h: 0.32 },
    range: { w: [0.7, 1.3], d: [0.18, 0.32] },
    againstWall: true,
    wallMounted: true,
    role: "lacquer",
    variants: [
      { id: "classic", label: "Classic rounded" },
      { id: "slim", label: "Slim flat front" },
    ],
  },
  kitchenCounter: {
    label: "kitchen counter",
    aliases: ["kitchen counter", "kitchen platform", "kitchen", "counter", "platform", "modular kitchen"],
    size: { w: 2.4, d: 0.6, h: 0.86 },
    range: { w: [1.0, 6.0], d: [0.55, 0.7] },
    againstWall: true,
    role: "lacquer",
    variants: [
      { id: "handleless", label: "Handleless with tall units" },
      { id: "classic", label: "Shaker with handles" },
    ],
  },
  fridge: {
    label: "refrigerator",
    aliases: ["refrigerator", "fridge"],
    size: { w: 0.7, d: 0.7, h: 1.8 },
    range: { w: [0.55, 1.0], d: [0.6, 0.8] },
    againstWall: true,
    role: "metal",
    variants: [{ id: "steel", label: "Stainless steel" }],
  },
  toilet: {
    label: "WC",
    aliases: ["toilet", "commode", "wc", "water closet"],
    size: { w: 0.4, d: 0.55, h: 0.4 },
    range: { w: [0.35, 0.5], d: [0.45, 0.75] },
    againstWall: true,
    role: "ceramic",
    variants: [
      { id: "wall-hung", label: "Wall hung" },
      { id: "floor", label: "Floor mounted" },
    ],
  },
  vanity: {
    label: "wash basin",
    aliases: ["wash basin", "washbasin", "basin", "vanity", "sink"],
    size: { w: 0.8, d: 0.48, h: 0.85 },
    range: { w: [0.45, 1.8], d: [0.35, 0.6] },
    againstWall: true,
    role: "wood",
    variants: [
      { id: "vanity-mirror", label: "Vanity with mirror" },
      { id: "counter-basin", label: "Counter-top basin" },
    ],
  },
  shower: {
    label: "shower",
    aliases: ["shower area", "shower", "wet area"],
    size: { w: 0.9, d: 0.9, h: 2.0 },
    range: { w: [0.8, 2.0], d: [0.8, 1.5] },
    againstWall: true,
    role: "ceramic",
    variants: [{ id: "glass", label: "Glass partition with rain shower" }],
  },
  bathtub: {
    label: "bathtub",
    aliases: ["bathtub", "bath tub", "tub"],
    size: { w: 1.7, d: 0.75, h: 0.55 },
    range: { w: [1.2, 2.0], d: [0.65, 0.9] },
    againstWall: true,
    role: "ceramic",
    variants: [{ id: "built-in", label: "Built-in" }],
  },
  bench: {
    label: "bench",
    aliases: ["bed bench", "bench", "settee bench"],
    size: { w: 1.3, d: 0.42, h: 0.45 },
    range: { w: [0.6, 2.0], d: [0.3, 0.6] },
    againstWall: false,
    role: "fabric",
    variants: [{ id: "upholstered", label: "Upholstered" }],
  },
  other: {
    label: "unit",
    aliases: [],
    size: { w: 0.8, d: 0.5, h: 0.8 },
    range: { w: [0.2, 4.0], d: [0.2, 4.0] },
    againstWall: false,
    role: "wood",
    variants: [{ id: "box", label: "Box" }],
  },
};

export const ITEM_TYPES = Object.keys(CATALOG) as ItemType[];

/** Human label for an item type, e.g. "side table". */
export function itemLabel(type: ItemType): string {
  return CATALOG[type].label;
}

/**
 * The item type a free word or plan label means ("almirah" → wardrobe,
 * "bedside table" → nightstand), or null. Longest alias wins, so "bed back"
 * is not read as "bed".
 */
export function typeFromWords(text: string): ItemType | null {
  const t = ` ${normalize(text)} `;
  let best: { type: ItemType; len: number } | null = null;
  for (const type of ITEM_TYPES) {
    for (const alias of CATALOG[type].aliases) {
      const a = ` ${normalize(alias)} `;
      if (t.includes(a) && (!best || a.length > best.len)) best = { type, len: a.length };
    }
  }
  return best?.type ?? null;
}

/** Lower-case, strip punctuation, collapse spaces, simple plural → singular. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 4 && /[^s]s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
}

/** The piece a room is shot "from behind": the bed in a bedroom, the sofa in a living room… */
export const MAIN_ITEM_ORDER: Record<RoomKind, ItemType[]> = {
  bedroom: ["bed", "sofa", "desk", "wardrobe"],
  kids: ["bed", "desk", "wardrobe"],
  living: ["sofa", "armchair", "diningSet", "tvUnit"],
  dining: ["diningSet", "sideboard"],
  kitchen: ["kitchenCounter", "diningSet"],
  bathroom: ["vanity", "bathtub", "shower"],
  study: ["desk", "sofa", "bookshelf"],
  other: ["bed", "sofa", "diningSet", "desk", "kitchenCounter", "vanity"],
};

export const ROOM_KINDS: { value: RoomKind; label: string }[] = [
  { value: "bedroom", label: "Bedroom" },
  { value: "living", label: "Living / drawing room" },
  { value: "dining", label: "Dining" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "study", label: "Study" },
  { value: "kids", label: "Kids room" },
  { value: "other", label: "Other" },
];

/** The room kind a plan label means ("MASTER BED RM" → bedroom). */
export function kindFromWords(text: string): RoomKind {
  const t = normalize(text);
  if (/\b(kid|child|children)\b/.test(t)) return "kids";
  if (/\b(bed|bedroom|bed room|master|guest)\b/.test(t)) return "bedroom";
  if (/\b(living|drawing|lounge|family|hall|sitting)\b/.test(t)) return "living";
  if (/\b(dining|dinning)\b/.test(t)) return "dining";
  if (/\b(kitchen|pantry)\b/.test(t)) return "kitchen";
  if (/\b(bath|toilet|wc|washroom|powder|ensuite)\b/.test(t)) return "bathroom";
  if (/\b(study|office|library|work)\b/.test(t)) return "study";
  return "other";
}
