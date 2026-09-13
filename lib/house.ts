// The whole-house model — shared, pure, no `three`, no `server-only`.
//
// Why: a room cropped out of the plan loses its context. The crop's detector
// had to guess where the walls were from the crop's edges, which door was the
// entry, and how big the room was (one printed dimension, if it could read
// it). ONE detection pass over the WHOLE plan returns every room, every door
// and window and every piece of furniture in one coordinate frame, so the
// walls come from the room boundaries (shared walls are shared), a door
// between two rooms belongs to both, and one scale — the median of every
// printed room dimension on the plan — sizes every room consistently. The
// 3D house is built from this model; picking a room is picking a rectangle
// inside it, and the room's own layout (`roomLocalBoxes`) is DERIVED from the
// house rather than re-detected from a crop.

import {
  boxCenter,
  coerceBoxList,
  extractJsonObject,
  isDoorLabel,
  isHelperLabel,
  isOpeningLabel,
  toMetres,
  type RoomSize,
  type SpatialBox,
} from "./spatial";

export type Box4 = [number, number, number, number];

/** One room of the plan: a rectangle in whole-plan 0-1000 coords plus its printed size, if read. */
export interface HouseRoom {
  label: string;
  box_2d: Box4;
  /** Printed dimensions in metres, as drawn (width = left-right, depth = top-bottom). */
  width_m?: number;
  depth_m?: number;
}

/** The plan as one model. All boxes are in the SAME 0-1000 frame of the full plan image. */
export interface HouseModel {
  rooms: HouseRoom[];
  /** Doors and windows (labels pass `isOpeningLabel`). */
  openings: SpatialBox[];
  /** Furniture and fixtures, including "pillows" helper boxes. */
  furniture: SpatialBox[];
  /** Metres spanned by the full plan image horizontally and vertically. */
  size: RoomSize;
  /** Whether `size` came from printed dimensions or from a typical-room-area guess. */
  sizeSource: "printed" | "estimated";
}

/** The raw parse of the detector's reply, before snapping and scaling. */
export type RawHouse = Pick<HouseModel, "rooms" | "openings" | "furniture">;

/**
 * System instruction for the whole-plan pass. One reply: rooms (with their
 * printed dimensions), openings and furniture, all in the plan's 0-1000 frame.
 */
export const HOUSE_EXTRACTION_PROMPT = [
  "You are a floor-plan reader. The image is a complete 2D ARCHITECTURAL FLOOR",
  "PLAN seen from directly above. Return its layout as ONE JSON object with",
  "three arrays, all in the same coordinate frame — integers 0-1000 over the",
  "whole image, Y first, top-left origin: box_2d = [ymin, xmin, ymax, xmax].",
  '1. "rooms": every room or named space as the rectangle of its floor area',
  "(inside the walls). label = the room name printed on the plan or its obvious",
  'type ("bedroom 1", "living room", "kitchen", "bathroom", "hall", "balcony").',
  "If a room's dimensions are printed (e.g. \"3,6 x 2,7\", \"12'0 x 9'6\"),",
  "add width_m and depth_m IN METRES as drawn: width_m is the horizontal",
  "(left-right) extent of that room's rectangle, depth_m the vertical",
  "(top-bottom) one — swap them if the printed order disagrees with how the",
  "room is drawn. Omit them when nothing is printed.",
  '2. "openings": every door (an arc/swing symbol in a wall gap, label "door";',
  'sliding/balcony doors "sliding door") and every window (thin parallel lines',
  'or a break in an exterior wall, label "window"). Box each one tightly over',
  "the wall gap it sits in. Be exhaustive: a typical home has 8-20 openings.",
  '3. "furniture": every furniture piece and fixture drawn as a symbol (bed,',
  "nightstand, wardrobe, sofa, armchair, coffee table, dining table, chair,",
  "desk, tv unit, kitchen counter, fridge, toilet, sink, bathtub, shower, rug,",
  'plant). One entry per item; for every bed ALSO add a separate "pillows" box',
  "covering just the pillow symbols at its head so the bed can be oriented.",
  "Scan every room; a furnished home has 15-40 items.",
  'Example: {"rooms":[{"label":"bedroom 1","box_2d":[60,520,470,960],',
  '"width_m":3.6,"depth_m":3.4}],"openings":[{"label":"door","box_2d":',
  '[455,600,480,690]},{"label":"window","box_2d":[50,640,70,840]}],',
  '"furniture":[{"label":"bed","box_2d":[110,600,380,790]},{"label":"pillows",',
  '"box_2d":[110,600,170,790]}]}',
  "Respond with ONLY that JSON object — the first character of your reply must",
  "be '{' and the last '}'. No prose, no markdown fences.",
].join(" ");

/** Forceful second pass when the first found too little of the plan. */
export const HOUSE_RETRY_PROMPT = [
  HOUSE_EXTRACTION_PROMPT,
  "IMPORTANT: a previous pass returned almost nothing, which is wrong for a",
  "floor plan. Look again carefully: list EVERY room rectangle, EVERY door and",
  "window, and EVERY furniture symbol you can see.",
].join(" ");

/** A plausible printed dimension: metres, or cm/mm brought back to metres. */
function metresOrNull(raw: unknown): number | undefined {
  let v = toMetres(raw);
  if (!Number.isFinite(v)) return undefined;
  if (v > 25 && v <= 2500) v /= 100;
  else if (v > 2500 && v <= 25_000) v /= 1000;
  return v >= 1 && v <= 25 ? v : undefined;
}

function isRoomLike(o: Record<string, unknown>): o is Record<string, unknown> & { label: string } {
  const label = o.label ?? o.name ?? o.type;
  return typeof label === "string" && label.trim().length > 0;
}

/**
 * Parse the detector's reply into a raw house. Tolerant: a missing array is
 * empty, any door/window that landed in "furniture" is moved to openings, a
 * furniture-like label in "openings" is moved back, rooms without a usable
 * box are dropped. Returns null when nothing room-shaped was returned, so
 * the caller can retry or fall back to the crop-based flow.
 */
export function parseHouseReply(content: string): RawHouse | null {
  // "3,6" inside bare JSON is invalid; a digit,digit pair is never JSON punctuation here.
  const parsed = extractJsonObject((content || "").replace(/(\d),(\d)/g, "$1.$2"));
  if (!parsed) return null;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const rooms: HouseRoom[] = [];
  for (const item of list(parsed.rooms ?? parsed.spaces)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!isRoomLike(o)) continue;
    const [box] = coerceBoxList([o]);
    if (!box) continue;
    const [ymin, xmin, ymax, xmax] = box.box_2d;
    if (xmax - xmin < 15 || ymax - ymin < 15) continue; // a sliver is not a room
    rooms.push({
      label: box.label,
      box_2d: box.box_2d,
      width_m: metresOrNull(o.width_m ?? o.width),
      depth_m: metresOrNull(o.depth_m ?? o.depth ?? o.length_m ?? o.length),
    });
  }
  if (!rooms.length) return null;

  const openings: SpatialBox[] = [];
  const furniture: SpatialBox[] = [];
  const all = [
    ...coerceBoxList(list(parsed.openings ?? parsed.doors_windows)),
    ...coerceBoxList(list(parsed.doors)),
    ...coerceBoxList(list(parsed.windows)),
    ...coerceBoxList(list(parsed.furniture ?? parsed.objects ?? parsed.items)),
  ];
  for (const b of all) (isOpeningLabel(b.label) ? openings : furniture).push(b);
  return { rooms, openings, furniture };
}

const SNAP_TOL = 14; // 0-1000 units; ~1.4% of the plan — two room edges this close share a wall

/** Cluster a sorted list of coordinates; each value is replaced by its cluster's mean. */
function snapValues(values: number[]): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out = new Map<number, number>();
  let cluster: number[] = [];
  const flush = () => {
    if (!cluster.length) return;
    const mean = cluster.reduce((s, v) => s + v, 0) / cluster.length;
    for (const v of cluster) out.set(v, mean);
    cluster = [];
  };
  for (const v of sorted) {
    if (cluster.length && v - cluster[cluster.length - 1] > SNAP_TOL) flush();
    cluster.push(v);
  }
  flush();
  return out;
}

/**
 * Median of a list (NaN for an empty one). Used for the plan scale so one
 * misread dimension can't stretch the whole house.
 */
function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const TYPICAL_ROOM_AREA_M2 = 12;

/**
 * Snap room edges onto shared wall lines and derive the plan's scale.
 *
 * Scale: each room with printed dimensions says how many metres its box
 * fraction spans, so it is one estimate of the plan's full extent; the
 * median of those estimates (both axes, brought to one number through the
 * plan's pixel aspect) is the scale. With no printed dimensions the median
 * room is assumed to be a typical 12 m², which keeps furniture at a sane
 * proportion and is flagged as "estimated" so the UI can say so.
 */
export function finalizeHouse(raw: RawHouse, planAspect: number): HouseModel {
  const aspect = Number.isFinite(planAspect) && planAspect > 0 ? planAspect : 1;
  const xs = snapValues(raw.rooms.flatMap((r) => [r.box_2d[1], r.box_2d[3]]));
  const ys = snapValues(raw.rooms.flatMap((r) => [r.box_2d[0], r.box_2d[2]]));
  const rooms: HouseRoom[] = raw.rooms.map((r) => {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    return {
      ...r,
      box_2d: [ys.get(ymin) ?? ymin, xs.get(xmin) ?? xmin, ys.get(ymax) ?? ymax, xs.get(xmax) ?? xmax],
    };
  });

  // Depth estimates (metres spanned by the plan's full height) from every printed dimension.
  const depthEstimates: number[] = [];
  for (const r of rooms) {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    const fx = (xmax - xmin) / 1000;
    const fy = (ymax - ymin) / 1000;
    if (fx <= 0.01 || fy <= 0.01) continue;
    let w = r.width_m;
    let d = r.depth_m;
    if (w && d) {
      // Printed order sometimes disagrees with how the room is drawn: the
      // wider-drawn axis gets the larger number.
      const drawnWider = fx * aspect >= fy;
      if (drawnWider !== w >= d) [w, d] = [d, w];
    }
    if (w) depthEstimates.push(w / fx / aspect);
    if (d) depthEstimates.push(d / fy);
  }
  let depth = median(depthEstimates);
  let sizeSource: HouseModel["sizeSource"] = "printed";
  if (!Number.isFinite(depth) || depth < 2 || depth > 80) {
    const areas = rooms.map((r) => ((r.box_2d[3] - r.box_2d[1]) / 1000) * ((r.box_2d[2] - r.box_2d[0]) / 1000));
    const medianFrac = median(areas.filter((a) => a > 0.002));
    const totalArea = Number.isFinite(medianFrac) ? TYPICAL_ROOM_AREA_M2 / medianFrac : 120;
    depth = Math.sqrt(totalArea / aspect);
    sizeSource = "estimated";
  }
  return {
    rooms,
    openings: raw.openings,
    furniture: raw.furniture,
    size: { width: depth * aspect, depth },
    sizeSource,
  };
}

/** True room size in metres for room `i`. */
export function roomSizeOf(house: HouseModel, i: number): RoomSize {
  const [ymin, xmin, ymax, xmax] = house.rooms[i].box_2d;
  return {
    width: (house.size.width * (xmax - xmin)) / 1000,
    depth: (house.size.depth * (ymax - ymin)) / 1000,
  };
}

/** Pixel aspect (w/h) of room `i` as drawn, given the plan image's own pixel aspect. */
export function roomAspectOf(house: HouseModel, i: number, planAspect: number): number {
  const [ymin, xmin, ymax, xmax] = house.rooms[i].box_2d;
  const h = ymax - ymin;
  return h > 0 ? (planAspect * (xmax - xmin)) / h : 1;
}

/** Room `i` as a crop rectangle in natural plan pixels. */
export function roomRectPx(
  house: HouseModel,
  i: number,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = house.rooms[i].box_2d;
  return {
    x: (xmin / 1000) * naturalWidth,
    y: (ymin / 1000) * naturalHeight,
    width: ((xmax - xmin) / 1000) * naturalWidth,
    height: ((ymax - ymin) / 1000) * naturalHeight,
  };
}

const OPENING_T = 40; // how far an opening's room-local box reaches into the room (0-1000 units)
const clampU = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/** Tolerance (plan units) for "this opening sits on this room's wall". */
function edgeTolerance(r: HouseRoom): number {
  const [ymin, xmin, ymax, xmax] = r.box_2d;
  return Math.max(10, Math.min(45, 0.1 * Math.min(xmax - xmin, ymax - ymin)));
}

/**
 * The layout of room `i` in the room's OWN 0-1000 frame — exactly what the
 * crop-based pipeline used to detect: the room's openings hugging the wall
 * they sit on, and every furniture item (with its pillows cue) inside it.
 * A door shared by two rooms belongs to both.
 */
export function roomLocalBoxes(house: HouseModel, i: number): SpatialBox[] {
  const r = house.rooms[i];
  const [ymin, xmin, ymax, xmax] = r.box_2d;
  const w = Math.max(1, xmax - xmin);
  const h = Math.max(1, ymax - ymin);
  const tol = edgeTolerance(r);
  const out: SpatialBox[] = [];

  for (const o of house.openings) {
    const { cx, cy } = boxCenter(o);
    if (cx < xmin - tol || cx > xmax + tol || cy < ymin - tol || cy > ymax + tol) continue;
    // Which of this room's four edges the opening sits on (nearest edge line).
    const d: Array<[number, "far" | "near" | "left" | "right"]> = [
      [Math.abs(cy - ymin), "far"],
      [Math.abs(cy - ymax), "near"],
      [Math.abs(cx - xmin), "left"],
      [Math.abs(cx - xmax), "right"],
    ];
    d.sort((a, b) => a[0] - b[0]);
    if (d[0][0] > tol) continue; // inside the room but on no wall: not this room's opening
    const wall = d[0][1];
    const [oy0, ox0, oy1, ox1] = o.box_2d;
    const alongX = wall === "far" || wall === "near";
    // Span along the wall, in room units, clamped to the room.
    const a0 = clampU(((alongX ? ox0 : oy0) - (alongX ? xmin : ymin)) / (alongX ? w : h) * 1000);
    const a1 = clampU(((alongX ? ox1 : oy1) - (alongX ? xmin : ymin)) / (alongX ? w : h) * 1000);
    if (a1 - a0 < 5) continue;
    const box: Box4 =
      wall === "far"
        ? [0, a0, OPENING_T, a1]
        : wall === "near"
          ? [1000 - OPENING_T, a0, 1000, a1]
          : wall === "left"
            ? [a0, 0, a1, OPENING_T]
            : [a0, 1000 - OPENING_T, a1, 1000];
    out.push({ label: o.label, box_2d: box });
  }

  for (const f of house.furniture) {
    const { cx, cy } = boxCenter(f);
    if (cx < xmin || cx > xmax || cy < ymin || cy > ymax) continue;
    const [fy0, fx0, fy1, fx1] = f.box_2d;
    out.push({
      label: f.label,
      box_2d: [
        clampU(((fy0 - ymin) / h) * 1000),
        clampU(((fx0 - xmin) / w) * 1000),
        clampU(((fy1 - ymin) / h) * 1000),
        clampU(((fx1 - xmin) / w) * 1000),
      ],
    });
  }
  return out;
}

/** A wall of the house: a straight segment on one axis with the openings cut into it. */
export interface WallSegment {
  /** "x": runs left-right at plan y = `at`; "z": runs top-bottom at plan x = `at`. */
  axis: "x" | "z";
  at: number;
  a0: number;
  a1: number;
  openings: Array<{ kind: "door" | "window"; start: number; end: number; index: number }>;
}

/**
 * Walls from the room rectangles: every room edge, with collinear overlapping
 * edges merged so a wall shared by two rooms is built once. Each opening is
 * attached to the nearest wall its centre lies on. All in plan units.
 */
export function houseWalls(house: HouseModel): WallSegment[] {
  type Edge = { axis: "x" | "z"; at: number; a0: number; a1: number };
  const edges: Edge[] = [];
  for (const r of house.rooms) {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    edges.push({ axis: "x", at: ymin, a0: xmin, a1: xmax });
    edges.push({ axis: "x", at: ymax, a0: xmin, a1: xmax });
    edges.push({ axis: "z", at: xmin, a0: ymin, a1: ymax });
    edges.push({ axis: "z", at: xmax, a0: ymin, a1: ymax });
  }
  // Group by axis + line (already snapped by finalizeHouse, so exact-ish), then union the intervals.
  const groups = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.axis}:${Math.round(e.at / (SNAP_TOL / 2))}`;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }
  const walls: WallSegment[] = [];
  for (const g of groups.values()) {
    const at = g.reduce((s, e) => s + e.at, 0) / g.length;
    const sorted = [...g].sort((a, b) => a.a0 - b.a0);
    let cur: { a0: number; a1: number } | null = null;
    for (const e of sorted) {
      if (cur && e.a0 <= cur.a1 + SNAP_TOL) cur.a1 = Math.max(cur.a1, e.a1);
      else {
        if (cur) walls.push({ axis: g[0].axis, at, a0: cur.a0, a1: cur.a1, openings: [] });
        cur = { a0: e.a0, a1: e.a1 };
      }
    }
    if (cur) walls.push({ axis: g[0].axis, at, a0: cur.a0, a1: cur.a1, openings: [] });
  }

  for (const [index, o] of house.openings.entries()) {
    const { cx, cy } = boxCenter(o);
    const [oy0, ox0, oy1, ox1] = o.box_2d;
    let best: { wall: WallSegment; dist: number } | null = null;
    for (const wall of walls) {
      const along = wall.axis === "x" ? cx : cy;
      const across = wall.axis === "x" ? cy : cx;
      if (along < wall.a0 - SNAP_TOL || along > wall.a1 + SNAP_TOL) continue;
      const dist = Math.abs(across - wall.at);
      if (!best || dist < best.dist) best = { wall, dist };
    }
    if (!best || best.dist > 3 * SNAP_TOL) continue;
    const start = Math.max(best.wall.a0, best.wall.axis === "x" ? ox0 : oy0);
    const end = Math.min(best.wall.a1, best.wall.axis === "x" ? ox1 : oy1);
    if (end - start < 5) continue;
    best.wall.openings.push({ kind: isDoorLabel(o.label) ? "door" : "window", start, end, index });
  }
  return walls;
}

/** Index of the room whose rectangle contains the point (plan units), or null. */
export function roomAt(house: HouseModel, x: number, y: number): number | null {
  let best: { i: number; area: number } | null = null;
  house.rooms.forEach((r, i) => {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    if (x < xmin || x > xmax || y < ymin || y > ymax) return;
    const area = (xmax - xmin) * (ymax - ymin);
    if (!best || area < best.area) best = { i, area }; // the smallest containing room wins
  });
  return best ? (best as { i: number }).i : null;
}

/** Human summary for the UI: "6 rooms · 11 openings · 23 items". */
export function summarizeHouse(house: HouseModel): string {
  const items = house.furniture.filter((f) => !isHelperLabel(f.label)).length;
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
  return `${n(house.rooms.length, "room")} · ${n(house.openings.length, "opening")} · ${n(items, "item")}`;
}

/** Guess the room-type chip from a detected room label ("bedroom 2" → bedroom). */
export function roomTypeFromLabel(
  label: string,
): "bedroom" | "living" | "kitchen" | "bathroom" | "dining" | "office" | "hallway" | "auto" {
  const l = label.toLowerCase();
  if (/\b(bed|master|guest|nursery|kids?)\b/.test(l)) return "bedroom";
  if (/\b(living|lounge|family|sitting|salon)\b/.test(l)) return "living";
  if (/\b(kitchen|pantry)\b/.test(l)) return "kitchen";
  if (/\b(bath|wc|toilet|ensuite|en-suite|shower|powder)\b/.test(l)) return "bathroom";
  if (/\b(dining|dinner)\b/.test(l)) return "dining";
  if (/\b(office|study|studio|work)\b/.test(l)) return "office";
  if (/\b(hall|corridor|entry|entrance|foyer|lobby|passage)\b/.test(l)) return "hallway";
  return "auto";
}
