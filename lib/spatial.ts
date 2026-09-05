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
  "You are an object-detection system. The image is a top-down (orthographic)",
  "crop of a 2D ARCHITECTURAL FLOOR PLAN showing a single room. Read the plan",
  "symbols: doors are an arc/swing drawn inside a gap in a wall; windows are thin",
  "parallel lines or a break in a wall; furniture is drawn as outline symbols",
  "(bed with pillows, sofa, table with chairs, wardrobe, toilet, sink, bathtub).",
  "Always return every window and door, even if the room has no furniture.",
  "Detect EVERY individual piece of furniture and every fixture, plus all windows",
  "and doors. Be exhaustive: a typical furnished room contains 4-10 items (e.g. a",
  "bedroom has a bed, two nightstands, a wardrobe/closet, a dresser or media unit,",
  "a window and a door). DO NOT stop after one object — scan the whole image and",
  "list each item you can see as a SEPARATE entry, even small ones.",
  'Each element is {"label": string, "box_2d": [ymin, xmin, ymax, xmax]}.',
  "Coordinates are integers normalized to 0-1000 with the Y coordinate first",
  "(top-left origin). Use a short, specific label (e.g. \"bed\", \"nightstand\",",
  "\"wardrobe\", \"sofa\", \"window\", \"door\").",
  "Example: [{\"label\":\"bed\",\"box_2d\":[300,350,720,650]},",
  "{\"label\":\"nightstand\",\"box_2d\":[300,300,420,350]},",
  "{\"label\":\"window\",\"box_2d\":[0,350,40,650]}]",
  "Limit to the 25 most prominent items.",
  "Respond with ONLY a JSON array — the first character of your reply must be",
  "'[' and the last must be ']'. No prose, no explanation, no markdown fences.",
  "If the room is genuinely empty, return [].",
].join(" ");

/** Real-world room size in metres, read from the plan's printed dimensions. */
export interface RoomSize {
  /** Horizontal (left-right) extent of the crop, in metres. */
  width: number;
  /** Vertical (top-bottom) extent of the crop, in metres. */
  depth: number;
}

/**
 * Asks the vision model to read the dimensions printed on the plan crop (e.g.
 * "3,6 m x 2,7 m"). Used to scale the 3D blockout to the real room instead of
 * assuming a fixed size, so furniture reads at the right proportion.
 */
export const ROOM_DIMENSION_PROMPT = [
  "You read dimensions off architectural floor plans. The image is a top-down",
  "crop of a 2D floor plan showing ONE room. Find the room's printed dimension",
  'text, e.g. "3,6 m x 2,7 m" or "3.6 x 2.7" (ignore any imperial text in',
  'parentheses such as (11\' 9" x 8\' 10")).',
  "Map them onto the image: width_m is the HORIZONTAL (left-to-right) extent of",
  "the room as drawn, depth_m is the VERTICAL (top-to-bottom) extent as drawn.",
  "Compare against how the room is drawn — if the room is drawn wider than it is",
  "tall, then width_m must be the larger number.",
  'Respond with ONLY JSON: {"width_m": number, "depth_m": number}.',
  "If no dimensions are printed, respond with exactly {}.",
  "No prose, no markdown fences.",
].join(" ");

/**
 * Pull the outermost JSON object out of an LLM reply: strips markdown fences,
 * slices from the first "{" to the last "}", and parses safely. Shared by the
 * dimension parser, the box parser's object branch and the verifier parser so
 * hardening happens in one place. Returns null on anything malformed.
 */
export function extractJsonObject(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const text = content.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parse a dimension value that may be a number, "3.6", or a comma decimal "3,6". */
function toMetres(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return NaN;
  return Number(raw.trim().replace(/\s*m$/i, "").replace(",", "."));
}

/**
 * Parse the dimension reply. Tolerates comma decimals ("3,6" — the format the
 * prompt's own example uses, both quoted and as bare JSON) and cm/mm values.
 * Returns null when absent or implausible, so the caller falls back to the
 * aspect-ratio heuristic.
 */
export function parseRoomDimensions(content: string): RoomSize | null {
  if (!content) return null;
  // Bare "3,6" inside JSON is invalid; a digit,digit pair is never valid JSON
  // punctuation here (JSON separators are followed by a space or a quote), so
  // rewrite it to a dot before parsing.
  const parsed = extractJsonObject(content.replace(/(\d),(\d)/g, "$1.$2"));
  if (!parsed) return null;
  let width = toMetres(parsed.width_m);
  let depth = toMetres(parsed.depth_m);
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return null;
  // Values above any real room in metres are almost certainly cm or mm.
  if (width > 25 || depth > 25) {
    if (width <= 2500 && depth <= 2500) {
      width /= 100;
      depth /= 100;
    } else if (width <= 25_000 && depth <= 25_000) {
      width /= 1000;
      depth /= 1000;
    }
  }
  // Rooms outside this range are almost certainly a misread, not a real room.
  const sane = (v: number) => v >= 1 && v <= 25;
  if (!sane(width) || !sane(depth)) return null;
  return { width, depth };
}

/** Forceful second-pass instruction used when the first detection found < 2 items. */
export const SPATIAL_RETRY_PROMPT = [
  SPATIAL_EXTRACTION_PROMPT,
  "IMPORTANT: a previous pass found almost nothing, which is wrong for a",
  "furnished room. Look again carefully and return EVERY bed, seat, table, desk,",
  "cabinet, wardrobe, appliance, rug, window and door you can identify — aim for",
  "at least 4 items if the room is furnished.",
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
    const obj = extractJsonObject(text);
    if (obj) parsed = firstArrayProp(obj);
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

/**
 * Short human summary of detected labels with counts, e.g.
 * "bed, 2 nightstands, media cabinet, window" — for the UI coverage line.
 */
export function summarizeLabels(boxes: SpatialBox[]): string {
  if (!boxes.length) return "";
  const counts = new Map<string, number>();
  for (const b of boxes) counts.set(b.label, (counts.get(b.label) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, n]) => (n > 1 ? `${n} ${label}s` : label))
    .join(", ");
}

/**
 * True if the label is a door of any kind. The single definition used for the
 * camera position, the blockout panel colour, height priors and the layout
 * text, so they agree by construction.
 */
export function isDoorLabel(label: string): boolean {
  return /\b(door|doorway|entry|entrance|opening|archway)\b/.test(label.toLowerCase());
}

/** Doors that are NOT the natural place to stand: balconies, closets, etc. */
function isSecondaryDoor(label: string): boolean {
  return /\b(sliding|balcony|closet|wardrobe|french|patio|glass|cupboard)\b/.test(
    label.toLowerCase(),
  );
}

/** True if the label is a wall opening (window/door) rather than furniture. */
export function isOpeningLabel(label: string): boolean {
  return isDoorLabel(label) || /\b(window|skylight)\b/.test(label.toLowerCase());
}

/** Centre of a box in 0-1000 crop coordinates. */
export function boxCenter(b: SpatialBox): { cx: number; cy: number } {
  const [ymin, xmin, ymax, xmax] = b.box_2d;
  return { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 };
}

/** Approximate height (metres) of a furniture/fixture label, for the 3D blockout. */
export function furnitureHeight(label: string): number {
  const l = label.toLowerCase();
  if (isDoorLabel(l)) return 2.0;
  if (/\b(wardrobe|closet|cupboard|cabinet|bookshelf|shelf|fridge|refrigerator)\b/.test(l)) return 2.0;
  if (/\b(curtain|window|skylight)\b/.test(l)) return 1.5;
  if (/\b(plant|lamp|floor lamp|mirror|tv|television)\b/.test(l)) return 1.4;
  if (/\b(desk|table|dining table|dresser|vanity|sink|basin|counter|kitchen)\b/.test(l)) return 0.78;
  if (/\b(sofa|couch|armchair|chair|toilet|bathtub|bath|stool|bench)\b/.test(l)) return 0.85;
  if (/\b(bed|mattress)\b/.test(l)) return 0.55;
  if (/\b(nightstand|bedside|side table|coffee table|ottoman)\b/.test(l)) return 0.5;
  // Floor coverings are flat. A 0.5m prior turned every rug into a half-metre
  // block that the renderer then "furnished" as a bench or an ottoman.
  if (/\b(rug|carpet|mat)\b/.test(l)) return 0.02;
  return 0.8;
}

/** Coarse furniture category, used to colour-code the blockout massing map. */
export type FurnitureCategory =
  | "bed"
  | "seating"
  | "storage"
  | "table"
  | "bath"
  | "rug"
  | "other";

export function furnitureCategory(label: string): FurnitureCategory {
  const l = label.toLowerCase();
  if (/\b(bed|mattress|headboard)\b/.test(l)) return "bed";
  if (/\b(sofa|couch|armchair|chair|stool|bench|ottoman)\b/.test(l)) return "seating";
  if (/\b(wardrobe|closet|cupboard|cabinet|bookshelf|shelf|dresser|drawers|fridge|refrigerator|tv|television|media)\b/.test(l))
    return "storage";
  if (/\b(desk|table|nightstand|bedside|counter|vanity|kitchen)\b/.test(l)) return "table";
  if (/\b(sink|basin|toilet|bath|bathtub|shower)\b/.test(l)) return "bath";
  if (/\b(rug|carpet|mat)\b/.test(l)) return "rug";
  return "other";
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

/** Map a 0-1000 center to a coarse zone word. */
function band(v: number, low: string, mid: string, high: string): string {
  if (v < 333) return low;
  if (v < 666) return mid;
  return high;
}

/**
 * Where the eye-level camera stands, in crop (0-1000) coordinates. Pure and
 * deterministic so the blockout renderer and the layout text (prompt writer +
 * verifier) call the SAME function and always agree on the viewpoint.
 *
 * Prefers the detected door (the natural "standing in the doorway" shot),
 * skipping balcony/closet-style doors when a plain door exists. Falls back to
 * the wall with the fewest items. In every case the spot is clamped away from
 * the corners and rejected if it would sit inside a furniture footprint.
 */
export interface CameraSpot {
  wall: Wall;
  /** Position along that wall, 0-1000 (x for far/near, y for left/right). */
  along: number;
  atDoor: boolean;
}

const CAMERA_INSET = 90; // ≈0.35m from the wall as a fraction of a typical room
const CAMERA_MARGIN = 40; // keep this far from any furniture box
// Only something at least this tall (metres) can block the lens: the camera
// stands at eye level, so it looks straight over a rug, a bench or a low table.
// (A rug by the door used to reject the door wall and flip the whole view.)
const BLOCKING_HEIGHT = 1.0;

function insideFurniture(boxes: SpatialBox[], x: number, y: number): boolean {
  return boxes.some((b) => {
    if (isOpeningLabel(b.label) || furnitureHeight(b.label) < BLOCKING_HEIGHT) return false;
    const [ymin, xmin, ymax, xmax] = b.box_2d;
    return (
      x >= xmin - CAMERA_MARGIN &&
      x <= xmax + CAMERA_MARGIN &&
      y >= ymin - CAMERA_MARGIN &&
      y <= ymax + CAMERA_MARGIN
    );
  });
}

function spotPoint(wall: Wall, along: number): { x: number; y: number } {
  switch (wall) {
    case "far":
      return { x: along, y: CAMERA_INSET };
    case "near":
      return { x: along, y: 1000 - CAMERA_INSET };
    case "left":
      return { x: CAMERA_INSET, y: along };
    default:
      return { x: 1000 - CAMERA_INSET, y: along };
  }
}

export function cameraSpot(boxes: SpatialBox[]): CameraSpot {
  // Pulled toward the middle of its wall. Standing hard against a corner puts
  // whatever occupies that corner across half the frame — a door in the corner
  // of a small bedroom left a wardrobe filling a third of the render — while
  // keeping some offset preserves the sense of entering from the door side.
  const clamp = (v: number) => Math.min(700, Math.max(300, 500 + (v - 500) * 0.45));

  const doors = boxes.filter((b) => isDoorLabel(b.label));
  const door = doors.find((b) => !isSecondaryDoor(b.label)) ?? doors[0];
  const doorWall = door ? nearestWall(boxCenter(door).cx, boxCenter(door).cy) : null;

  // 1. The plan's bottom edge, so the render keeps the plan's orientation:
  // plan-left is render-left and the top of the plan is the back wall. The
  // old "stand in the doorway" rule put the camera on whichever wall held the
  // door — with a door at the top of the plan the whole view came out
  // mirrored, which reads as "the layout changed" when compared to the plan,
  // and the door itself was behind the lens, so the render could never show
  // it. From the bottom edge a door on any other wall is IN frame and gets
  // verified like everything else.
  {
    const along = door && doorWall === "near" ? clamp(boxCenter(door).cx) : 500;
    const p = spotPoint("near", along);
    if (!insideFurniture(boxes, p.x, p.y)) return { wall: "near", along, atDoor: doorWall === "near" };
  }

  // 2. Blocked there → the door wall.
  if (door && doorWall && doorWall !== "near") {
    const { cx, cy } = boxCenter(door);
    const along = clamp(doorWall === "far" ? cx : cy);
    const p = spotPoint(doorWall, along);
    if (!insideFurniture(boxes, p.x, p.y)) return { wall: doorWall, along, atDoor: true };
  }

  // 3. Emptiest wall first, then the others, skipping spots inside furniture.
  const counts: Record<Wall, number> = { far: 0, near: 0, left: 0, right: 0 };
  for (const b of boxes) {
    const { cx, cy } = boxCenter(b);
    counts[nearestWall(cx, cy)] += 1;
  }
  const order = (["far", "near", "left", "right"] as Wall[]).sort((a, b) => counts[a] - counts[b]);
  for (const wall of order) {
    const p = spotPoint(wall, 500);
    if (!insideFurniture(boxes, p.x, p.y)) return { wall, along: 500, atDoor: false };
  }
  return { wall: order[0], along: 500, atDoor: false };
}

/** The wall directly across from the viewer for each viewpoint. */
const OPPOSITE: Record<Wall, Wall> = { far: "near", near: "far", left: "right", right: "left" };
/** The wall on the viewer's LEFT for each viewpoint (three.js right-handed, y up). */
const VIEWER_LEFT: Record<Wall, Wall> = { near: "left", far: "right", left: "far", right: "near" };

/**
 * Convert a crop centre into viewer-relative coordinates for a camera standing
 * at `from`: depth 0 = nearest the viewer, 1000 = the back wall; side 0 = the
 * viewer's left, 1000 = the viewer's right.
 */
function viewerRelative(from: Wall, cx: number, cy: number): { depth: number; side: number } {
  switch (from) {
    case "near":
      return { depth: 1000 - cy, side: cx };
    case "far":
      return { depth: cy, side: 1000 - cx };
    case "left":
      return { depth: cx, side: cy };
    default:
      return { depth: 1000 - cx, side: 1000 - cy };
  }
}

/**
 * Whether a wall is the one the camera stands outside of — behind the viewer,
 * so nothing on it is in frame. The ONE predicate shared by the blockout
 * (which culls that wall and its openings) and the layout text (which marks
 * such openings "not visible" for the prompt writer and the verifier).
 */
export function isBehindViewer(spot: CameraSpot, wall: Wall): boolean {
  return wall === spot.wall;
}

function wallWordFrom(spot: CameraSpot, wall: Wall): string {
  const from = spot.wall;
  if (isBehindViewer(spot, wall)) return "wall behind the viewer (not visible)";
  if (wall === OPPOSITE[from]) return "back wall (facing the viewer)";
  return wall === VIEWER_LEFT[from] ? "left wall" : "right wall";
}

/**
 * Turn detected boxes into a compact natural-language layout the prompt writer
 * can anchor to and the verifier can check. Everything is described RELATIVE
 * TO THE VIEWER standing where the blockout camera stands (`cameraSpot`), so
 * "back", "left" and "right" mean the same thing in the text, the blockout and
 * the render. Furniture is described by zone ("back-left", "center", …);
 * windows/doors by which wall they sit on. Repeated labels are collapsed into
 * counts ("two beds"). Returns "" for an empty list.
 */
export function describeLayout(boxes: SpatialBox[]): string {
  if (!boxes.length) return "";

  const spot = cameraSpot(boxes);
  const from = spot.wall;

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
      const { cx, cy } = boxCenter(b);
      if (isOpeningLabel(label)) return wallWordFrom(spot, nearestWall(cx, cy));
      const { depth, side } = viewerRelative(from, cx, cy);
      const vert = band(depth, "front", "middle", "back");
      const horiz = band(side, "left", "center", "right");
      return vert === "middle" && horiz === "center" ? "center" : `${vert}-${horiz}`;
    });

    if (isOpeningLabel(label)) {
      const noun = group.length > 1 ? `${label}s` : label;
      openings.push(`${countWord(group.length)} ${noun} on the ${[...new Set(places)].join(" and ")}`);
    } else if (group.length > 1) {
      furniture.push(`${countWord(group.length)} ${label}s (${places.join("; ")})`);
    } else {
      furniture.push(`a ${label} at ${places[0]}`);
    }
  }

  const parts: string[] = [
    `Viewpoint: eye-level, standing at one wall looking across the room. "Back" is the wall facing the viewer, "front" is nearest the viewer, "left"/"right" are the viewer's left and right; the wall behind the viewer is not visible.`,
  ];
  if (furniture.length) parts.push(`Furniture (positions relative to the viewer): ${furniture.join(", ")}.`);
  if (openings.length) parts.push(`Openings: ${openings.join(", ")}.`);
  return parts.join(" ");
}
