// Stage 3a spatial grounding — shared, pure, no `server-only` (used by both the
// server prompt writer in lib/kieChat.ts and the browser one in lib/kieBrowser.ts).
//
// Why this exists: the room render is text-to-image, and a text prompt is only
// "soft guidance" to the image model, so layouts drift. Gemini's spatial
// understanding reliably returns parseable 2D bounding boxes from an image, so
// we run a detection pass on the top-down room crop and feed the DETECTED layout
// (items, counts, positions) to the prompt writer as ground truth. This grounds
// the written prompt; it does NOT hard-enforce geometry (that would need
// ControlNet/structural conditioning, unavailable on nano-banana / Gemini image).

/** One detected object: a label + a 2D box in Gemini's 0-1000 [ymin,xmin,ymax,xmax] space. */
export interface SpatialBox {
  label: string;
  box_2d: [number, number, number, number];
}

/**
 * System instruction for the detection pass. Gemini returns object boxes for a
 * plain natural-language prompt; we constrain it to a strict JSON array so the
 * output is machine-parseable. Coordinate convention is Gemini's documented one
 * (normalized 0-1000, y before x).
 */
export const SPATIAL_EXTRACTION_PROMPT = [
  "You are an object-detection system. The image is a top-down view of a single",
  "room from a floor plan / 3D overview.",
  "Detect every piece of furniture and every fixture, plus all windows and doors.",
  'Each element is {"label": string, "box_2d": [ymin, xmin, ymax, xmax]}.',
  "Coordinates are integers normalized to 0-1000 with the Y coordinate first",
  "(top-left origin). Use a short, specific label (e.g. \"bed\", \"sofa\", \"window\",",
  "\"door\"). List each physical item separately so counts are accurate. Limit to",
  "the 25 most prominent items.",
  "Respond with ONLY a JSON array — the first character of your reply must be",
  "'[' and the last must be ']'. No prose, no explanation, no markdown fences.",
  "If the room is genuinely empty, return [].",
].join(" ");

/** Pull the first array-valued property out of a parsed object, if any. */
function firstArrayProp(obj: Record<string, unknown>): unknown[] | null {
  for (const v of Object.values(obj)) if (Array.isArray(v)) return v;
  return null;
}

/** Coerce a 4-number box (any common key/scale) to 0-1000 [ymin,xmin,ymax,xmax]. */
function coerceBox(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const n = raw.map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  const [a, b, c, d] = n as [number, number, number, number];
  const max = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  // Rescale to 0-1000: 0-1 normalized → ×1000; pixel coords (>1000) → ÷max×1000.
  if (max <= 1) return [a * 1000, b * 1000, c * 1000, d * 1000];
  if (max > 1000) return [(a / max) * 1000, (b / max) * 1000, (c / max) * 1000, (d / max) * 1000];
  return [a, b, c, d];
}

/**
 * Parse the detection model's reply into boxes. Tolerant of markdown fences,
 * surrounding prose, an object wrapper ({objects:[…]}), alternate key names
 * (box/bbox/bounding_box, name/class) and coordinate scales (0-1, 0-1000, or
 * pixels). Returns [] on any malformed input so callers degrade gracefully.
 */
export function parseSpatialBoxes(content: string): SpatialBox[] {
  if (!content) return [];
  let text = content.trim();
  // Strip ```json fences if present.
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();

  // Prefer the outermost array; if the model wrapped it in an object, parse that.
  let parsed: unknown = null;
  const aStart = text.indexOf("[");
  const aEnd = text.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    try {
      parsed = JSON.parse(text.slice(aStart, aEnd + 1));
    } catch {
      /* fall through to object parse */
    }
  }
  if (!Array.isArray(parsed)) {
    const oStart = text.indexOf("{");
    const oEnd = text.lastIndexOf("}");
    if (oStart !== -1 && oEnd > oStart) {
      try {
        const obj = JSON.parse(text.slice(oStart, oEnd + 1));
        if (obj && typeof obj === "object") parsed = firstArrayProp(obj as Record<string, unknown>);
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(parsed)) return [];

  const boxes: SpatialBox[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const labelRaw = o.label ?? o.name ?? o.class ?? o.type;
    const boxRaw = o.box_2d ?? o.box ?? o.bbox ?? o.bounding_box ?? o.boundingBox;
    if (typeof labelRaw !== "string" || !labelRaw.trim()) continue;
    const box = coerceBox(boxRaw);
    if (!box) continue;
    boxes.push({ label: labelRaw.trim().toLowerCase(), box_2d: box });
  }
  return boxes;
}

const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"];
function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

/** True if the label is a wall opening (window/door) rather than furniture. */
export function isOpeningLabel(label: string): boolean {
  return /\b(window|door|doorway|entry|opening|sliding door|french door|skylight)\b/.test(
    label.toLowerCase(),
  );
}

/** Approximate height (metres) of a furniture/fixture label, for the 3D blockout. */
export function furnitureHeight(label: string): number {
  const l = label.toLowerCase();
  if (/\b(wardrobe|closet|cupboard|cabinet|bookshelf|shelf|fridge|refrigerator)\b/.test(l)) return 2.0;
  if (/\b(door|doorway)\b/.test(l)) return 2.0;
  if (/\b(curtain|window|skylight)\b/.test(l)) return 1.5;
  if (/\b(plant|lamp|floor lamp|mirror|tv|television)\b/.test(l)) return 1.4;
  if (/\b(desk|table|dining table|dresser|vanity|sink|basin|counter|kitchen)\b/.test(l)) return 0.78;
  if (/\b(sofa|couch|armchair|chair|toilet|bathtub|bath|stool|bench)\b/.test(l)) return 0.85;
  if (/\b(bed|mattress)\b/.test(l)) return 0.55;
  if (/\b(nightstand|bedside|side table|coffee table|rug|carpet|ottoman)\b/.test(l)) return 0.5;
  return 0.8;
}

export type Wall = "far" | "near" | "left" | "right";

/** Which wall a center (0-1000 coords, top = far) sits nearest to. */
export function nearestWall(cx: number, cy: number): Wall {
  const dists: Array<[number, Wall]> = [
    [cy, "far"],
    [1000 - cy, "near"],
    [cx, "left"],
    [1000 - cx, "right"],
  ];
  dists.sort((a, b) => a[0] - b[0]);
  return dists[0][1];
}

const WALL_WORD: Record<Wall, string> = {
  far: "far wall (back)",
  near: "near wall (front)",
  left: "left wall",
  right: "right wall",
};

/** Map a 0-1000 center to a coarse zone word. */
function band(v: number, low: string, mid: string, high: string): string {
  if (v < 333) return low;
  if (v < 666) return mid;
  return high;
}

/**
 * Turn detected boxes into a compact natural-language layout the prompt writer
 * can anchor to. Furniture is described by zone ("back-left", "center", …);
 * windows/doors are described by which wall they sit on. Repeated labels are
 * collapsed into counts ("two beds"). Returns "" for an empty list.
 */
export function describeLayout(boxes: SpatialBox[]): string {
  if (!boxes.length) return "";

  const isOpening = isOpeningLabel;

  const furniture: string[] = [];
  const openings: string[] = [];
  // Group identical labels so we can both count them and place each instance.
  const byLabel = new Map<string, SpatialBox[]>();
  for (const b of boxes) {
    const arr = byLabel.get(b.label) ?? [];
    arr.push(b);
    byLabel.set(b.label, arr);
  }

  for (const [label, group] of byLabel) {
    const places = group.map((b) => {
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      const cy = (ymin + ymax) / 2;
      const cx = (xmin + xmax) / 2;
      if (isOpening(label)) return WALL_WORD[nearestWall(cx, cy)];
      const vert = band(cy, "back", "middle", "front");
      const horiz = band(cx, "left", "center", "right");
      return vert === "middle" && horiz === "center" ? "center" : `${vert}-${horiz}`;
    });

    if (isOpening(label)) {
      const noun = group.length > 1 ? `${label}s` : label;
      openings.push(`${countWord(group.length)} ${noun} on the ${[...new Set(places)].join(" and ")}`);
    } else if (group.length > 1) {
      furniture.push(`${countWord(group.length)} ${label}s (${places.join("; ")})`);
    } else {
      furniture.push(`a ${label} at ${places[0]}`);
    }
  }

  const parts: string[] = [];
  if (furniture.length) parts.push(`Furniture (positions relative to the room): ${furniture.join(", ")}.`);
  if (openings.length) parts.push(`Openings: ${openings.join(", ")}.`);
  return parts.join(" ");
}
