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
  "Return ONLY a JSON array (no prose, no markdown fences) where each element is",
  '{"label": string, "box_2d": [ymin, xmin, ymax, xmax]}.',
  "Coordinates are integers normalized to 0-1000 with the Y coordinate first",
  "(top-left origin). Use a short, specific label (e.g. \"bed\", \"sofa\", \"window\",",
  "\"door\"). List each physical item separately so counts are accurate. Limit to",
  "the 25 most prominent items. If the room is empty, return [].",
].join(" ");

/**
 * Parse the detection model's reply into boxes. Tolerant of markdown fences and
 * surrounding prose; returns [] on any malformed input so callers can degrade
 * gracefully (no layout block, today's behavior).
 */
export function parseSpatialBoxes(content: string): SpatialBox[] {
  if (!content) return [];
  let text = content.trim();
  // Strip ```json fences if present.
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();
  // Grab the outermost JSON array if the model wrapped it in prose.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const boxes: SpatialBox[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const label = (item as { label?: unknown }).label;
    const box = (item as { box_2d?: unknown }).box_2d;
    if (typeof label !== "string" || !label.trim()) continue;
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      box.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      continue;
    }
    boxes.push({
      label: label.trim().toLowerCase(),
      box_2d: [box[0], box[1], box[2], box[3]] as [number, number, number, number],
    });
  }
  return boxes;
}

const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"];
function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

/** Map a 0-1000 center to a coarse zone word. */
function band(v: number, low: string, mid: string, high: string): string {
  if (v < 333) return low;
  if (v < 666) return mid;
  return high;
}

/** Which wall a window/door box sits against, from its center. */
function wallOf(cx: number, cy: number): string {
  // Distance of the center to each of the four edges; nearest edge = its wall.
  const dists: Array<[number, string]> = [
    [cy, "far wall (back)"],
    [1000 - cy, "near wall (front)"],
    [cx, "left wall"],
    [1000 - cx, "right wall"],
  ];
  dists.sort((a, b) => a[0] - b[0]);
  return dists[0][1];
}

/**
 * Turn detected boxes into a compact natural-language layout the prompt writer
 * can anchor to. Furniture is described by zone ("back-left", "center", …);
 * windows/doors are described by which wall they sit on. Repeated labels are
 * collapsed into counts ("two beds"). Returns "" for an empty list.
 */
export function describeLayout(boxes: SpatialBox[]): string {
  if (!boxes.length) return "";

  const isOpening = (label: string) =>
    /\b(window|door|doorway|entry|opening|sliding door|french door)\b/.test(label);

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
      if (isOpening(label)) return wallOf(cx, cy);
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
