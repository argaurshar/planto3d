// From what the AI saw on the plan to the exact room model.
//
// The AI reads the plan ONCE and only reports what is drawn: the room's inner
// wall lines, the printed dimensions, and a box per door, window and furniture
// symbol (Gemini's native [ymin, xmin, ymax, xmax] 0-1000 boxes). Everything
// after that is deterministic geometry here: true scale from the printed
// dimensions, each opening snapped to its wall, each piece of furniture given
// its real size range, turned so its back is on the right wall, and pushed
// flush against it. The AI never draws or places anything itself.

import type { Dir, Item, ItemType, Opening, OpeningKind, RoomKind, RoomModel, Wall } from "./types";
import { CATALOG, kindFromWords, normalize, typeFromWords } from "./catalog";
import { STYLES } from "./styles";
import { clamp, dirOfWall, opposite, round2, wallOfDir, type Rect } from "./geometry";
import { variantFrom } from "./commands";
import { WALL_CLEAR } from "./constants";
import { settle } from "./place";

/** The JSON the plan reader is asked for (see lib/ai/prompts.ts). */
export interface PlanReading {
  room_name?: string;
  room_type?: string;
  room_box?: number[];
  printed_size?: { horizontal?: string | null; vertical?: string | null } | null;
  openings?: { kind?: string; box?: number[]; main?: boolean }[];
  items?: { label?: string; box?: number[]; head?: string | null; front?: string | null }[];
  notes?: string;
}

export interface ReadResult {
  room: RoomModel;
  /** Things the user should know (estimated scale, dropped symbols…). */
  warnings: string[];
}

/** Pull the first JSON object out of a model's answer (tolerates ``` fences and prose). */
export function parseJsonObject<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI did not return JSON.");
  return JSON.parse(body.slice(start, end + 1)) as T;
}

/**
 * A printed dimension to metres: 12'0", 12'-6", 12' 6", 12 ft 6 in, 12.5',
 * 3600, 3600 mm, 360 cm, 3.6 m, 3.60M. Bare numbers: > 100 → mm, ≤ 8 → m,
 * otherwise feet.
 */
export function parseDimension(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/,/g, ".").trim();
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches|''))?/);
  if (m) return parseFloat(m[1]) * 0.3048 + (m[2] ? parseFloat(m[2]) * 0.0254 : 0);
  m = s.match(/(\d+(?:\.\d+)?)\s*mm\b/);
  if (m) return parseFloat(m[1]) / 1000;
  m = s.match(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (m) return parseFloat(m[1]) / 100;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:m|mtr|meters?|metres?)\b/);
  if (m) return parseFloat(m[1]);
  m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (v > 100) return v / 1000;
  if (v <= 8) return v;
  return v * 0.3048;
}

/** Typical floor area by room kind, for when nothing on the plan gives the scale. */
const TYPICAL_AREA: Record<RoomKind, number> = { bedroom: 13, kids: 11, living: 19, dining: 11, kitchen: 8, bathroom: 4.5, study: 9, other: 12 };

const HELPER = /\b(pillow|headboard|head board|dimension|text|label|arrow|wall|column|beam|door|window|opening|arc|swing)\b/;

type Box = { x0: number; z0: number; x1: number; z1: number };

function boxPx(b: number[] | undefined, W: number, H: number): Box | null {
  if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = b.map((v) => clamp(v, 0, 1000));
  if (xmax - xmin < 2 || ymax - ymin < 2) return null;
  return { x0: (xmin / 1000) * W, x1: (xmax / 1000) * W, z0: (ymin / 1000) * H, z1: (ymax / 1000) * H };
}

function wallWord(v: unknown): Wall | null {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (/top|up|north/.test(s)) return "top";
  if (/bottom|down|south/.test(s)) return "bottom";
  if (/left|west/.test(s)) return "left";
  if (/right|east/.test(s)) return "right";
  return null;
}

function gaps(r: Rect, W: number, D: number): Record<Wall, number> {
  return { top: r.z0, bottom: D - r.z1, left: r.x0, right: W - r.x1 };
}

function nearest(r: Rect, W: number, D: number, exclude?: Wall): { wall: Wall; gap: number } {
  const g = gaps(r, W, D);
  return (Object.keys(g) as Wall[])
    .filter((w) => w !== exclude)
    .map((w) => ({ wall: w, gap: g[w] }))
    .sort((a, b) => a.gap - b.gap)[0];
}

/** Turn the AI's plan reading into a room model at true scale. */
export function readingToRoom(
  reading: PlanReading,
  image: { width: number; height: number },
  hint: { kind?: RoomKind; name?: string; planRef?: string } = {},
): ReadResult {
  const warnings: string[] = [];
  const IW = image.width;
  const IH = image.height;

  // 1. The room's interior rectangle in image pixels.
  const allBoxes = [...(reading.items ?? []), ...(reading.openings ?? [])].map((x) => boxPx(x.box, IW, IH)).filter((b): b is Box => !!b);
  let room = boxPx(reading.room_box, IW, IH);
  if (!room) {
    warnings.push("The room outline was not found, so the drawing's extent was used.");
    room = allBoxes.length
      ? {
          x0: Math.min(...allBoxes.map((b) => b.x0)),
          x1: Math.max(...allBoxes.map((b) => b.x1)),
          z0: Math.min(...allBoxes.map((b) => b.z0)),
          z1: Math.max(...allBoxes.map((b) => b.z1)),
        }
      : { x0: IW * 0.05, x1: IW * 0.95, z0: IH * 0.05, z1: IH * 0.95 };
  }
  const rw = room.x1 - room.x0;
  const rh = room.z1 - room.z0;

  const kind: RoomKind = hint.kind ?? (reading.room_type ? kindFromWords(reading.room_type) : "other");
  const kindFinal: RoomKind = kind !== "other" ? kind : kindFromWords(reading.room_name ?? "");

  // 2. Scale: the printed dimensions, axis-checked against the drawn shape.
  let wM = parseDimension(reading.printed_size?.horizontal ?? null);
  let dM = parseDimension(reading.printed_size?.vertical ?? null);
  if (wM && (wM < 1 || wM > 25)) wM = null;
  if (dM && (dM < 1 || dM > 25)) dM = null;
  if (wM && dM) {
    const drawn = Math.log(rw / rh);
    if (Math.abs(Math.log(dM / wM) - drawn) + 0.1 < Math.abs(Math.log(wM / dM) - drawn)) [wM, dM] = [dM, wM];
  }
  let sx: number;
  let sz: number;
  let scaleSource: RoomModel["scaleSource"] = "printed";
  if (wM && dM) {
    sx = wM / rw;
    sz = dM / rh;
  } else if (wM || dM) {
    const s = wM ? wM / rw : dM! / rh;
    sx = sz = s;
  } else {
    scaleSource = "estimated";
    // Things on every plan with a standard size: a door leaf (~0.9 m), a bed's width.
    const est: number[] = [];
    for (const o of reading.openings ?? []) {
      const b = boxPx(o.box, IW, IH);
      if (!b || !/door/.test(String(o.kind ?? "door"))) continue;
      const along = Math.max(b.x1 - b.x0, b.z1 - b.z0);
      if (along > 0) est.push(0.9 / along);
    }
    for (const it of reading.items ?? []) {
      const b = boxPx(it.box, IW, IH);
      const t = typeFromWords(it.label ?? "");
      if (!b || t !== "bed") continue;
      const short = Math.min(b.x1 - b.x0, b.z1 - b.z0);
      const single = /single|kid|child|bunk/.test(String(it.label).toLowerCase());
      if (short > 0) est.push((single ? 1.0 : 1.75) / short);
    }
    est.sort((a, b) => a - b);
    const area = TYPICAL_AREA[kindFinal];
    const fromArea = Math.sqrt(area / (rw * rh));
    const s = est.length ? est[Math.floor(est.length / 2)] : fromArea;
    // A wild estimate (a mis-read symbol) is pulled back towards a plausible room.
    const roomArea = rw * rh * s * s;
    sx = sz = roomArea < 3 || roomArea > 60 ? fromArea : s;
    warnings.push("No room dimensions were printed on the plan, so the size is estimated — set the real size in Room settings.");
  }
  const W = round2(clamp(rw * sx, 1.2, 25));
  const D = round2(clamp(rh * sz, 1.2, 25));
  sx = W / rw;
  sz = D / rh;
  const toRoom = (b: Box): Rect => ({
    x0: clamp((b.x0 - room!.x0) * sx, -0.5, W + 0.5),
    x1: clamp((b.x1 - room!.x0) * sx, -0.5, W + 0.5),
    z0: clamp((b.z0 - room!.z0) * sz, -0.5, D + 0.5),
    z1: clamp((b.z1 - room!.z0) * sz, -0.5, D + 0.5),
  });

  // 3. Doors and windows, each on the wall it is nearest to.
  const openings: Opening[] = [];
  for (const [i, o] of (reading.openings ?? []).entries()) {
    const b = boxPx(o.box, IW, IH);
    if (!b) continue;
    const r = toRoom(b);
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const dist: Record<Wall, number> = { top: Math.abs(cz - 0), bottom: Math.abs(cz - D), left: Math.abs(cx - 0), right: Math.abs(cx - W) };
    // A door box includes its swing arc, so use the box EDGE nearest each wall.
    const edge: Record<Wall, number> = { top: Math.abs(r.z0), bottom: Math.abs(D - r.z1), left: Math.abs(r.x0), right: Math.abs(W - r.x1) };
    const wall = (Object.keys(dist) as Wall[]).sort((a, b2) => edge[a] + dist[a] * 0.25 - (edge[b2] + dist[b2] * 0.25))[0];
    const horizontal = wall === "top" || wall === "bottom";
    const k0 = String(o.kind ?? "door").toLowerCase();
    // A "slider window" is a window; only a sliding DOOR (or balcony / french door) is full height.
    const kind: OpeningKind =
      /window|ventilator/.test(k0) && !/door/.test(k0) ? "window" : /slid|balcony|french/.test(k0) ? "sliding" : /open|arch|passage/.test(k0) ? "opening" : "door";
    const L = horizontal ? W : D;
    let width = horizontal ? r.x1 - r.x0 : r.z1 - r.z0;
    width = kind === "door" ? clamp(width, 0.7, 1.5) : kind === "window" ? clamp(width, 0.45, Math.min(4, L - 0.2)) : clamp(width, 0.8, Math.min(4.5, L - 0.2));
    width = Math.min(width, L - 0.1);
    const offset = clamp(horizontal ? cx : cz, width / 2 + 0.05, L - width / 2 - 0.05);
    const tall = kind !== "window";
    openings.push({
      id: `${kind === "window" ? "w" : kind === "sliding" ? "s" : "d"}${i + 1}`,
      kind,
      wall,
      offset: round2(offset),
      width: round2(width),
      height: tall ? 2.1 : 1.35,
      sill: tall ? 0 : 0.9,
      ...(o.main ? { main: true } : {}),
    });
  }
  // Drop duplicates (two boxes for one door) — keep the wider.
  const uniq: Opening[] = [];
  for (const o of openings.sort((a, b) => b.width - a.width)) {
    if (!uniq.some((u) => u.wall === o.wall && Math.abs(u.offset - o.offset) < (u.width + o.width) / 2 - 0.1)) uniq.push(o);
  }
  const doors = uniq.filter((o) => o.kind === "door" || o.kind === "opening");
  if (doors.length && !doors.some((o) => o.main)) doors[0].main = true;
  if (doors.filter((o) => o.main).length > 1) doors.slice(1).forEach((o) => delete o.main);

  // 4. Furniture: type, real size, the wall it backs onto, flush.
  const items: Item[] = [];
  const counts = new Map<ItemType, number>();
  let dropped = 0;
  for (const raw of reading.items ?? []) {
    const label = String(raw.label ?? "").slice(0, 60);
    const b = boxPx(raw.box, IW, IH);
    if (!b) continue;
    const words = normalize(label);
    const type = typeFromWords(words);
    if (!type) {
      if (HELPER.test(words)) continue;
      dropped++;
    }
    const t: ItemType = type ?? "other";
    const cat = CATALOG[t];
    const r = toRoom(b);
    const ex = Math.max(0.05, r.x1 - r.x0);
    const ez = Math.max(0.05, r.z1 - r.z0);
    let facing: Dir;
    const head = wallWord(raw.head);
    const front = wallWord(raw.front);
    const near = nearest(r, W, D);
    if (t === "bed" && head) facing = opposite(dirOfWall(head));
    else if (front) facing = dirOfWall(front);
    else if (cat.wallMounted || cat.againstWall) facing = opposite(dirOfWall(near.wall));
    else if (t === "armchair" || t === "chair") {
      // Turn loose seats towards the middle of the room.
      const cx = (r.x0 + r.x1) / 2 - W / 2;
      const cz = (r.z0 + r.z1) / 2 - D / 2;
      facing = Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? "left" : "right") : cz > 0 ? "up" : "down";
    } else facing = ex >= ez ? "down" : "right";
    const sideways = facing === "left" || facing === "right";
    let w = sideways ? ez : ex;
    let d = sideways ? ex : ez;
    // An L-shaped sofa's footprint is its bounding box; everything else gets a real size.
    if (!(t === "sofa" && /\bl\b|corner|sectional/.test(words))) {
      w = clamp(w, cat.range.w[0], cat.range.w[1]);
      d = clamp(d, cat.range.d[0], cat.range.d[1]);
    }
    if (t === "other") {
      w = clamp(sideways ? ez : ex, 0.2, 4);
      d = clamp(sideways ? ex : ez, 0.2, 4);
    }
    let x = (r.x0 + r.x1) / 2;
    let z = (r.z0 + r.z1) / 2;
    // Back flush to its wall when it is meant to stand against one.
    const back: Wall = wallOfDir(opposite(facing));
    const fx = sideways ? d / 2 : w / 2;
    const fz = sideways ? w / 2 : d / 2;
    const g = gaps({ x0: x - fx, x1: x + fx, z0: z - fz, z1: z + fz }, W, D);
    const flushGap = cat.wallMounted ? 0 : WALL_CLEAR;
    if ((cat.againstWall || cat.wallMounted || t === "bed") && g[back] < 0.5) {
      if (back === "top") z = flushGap + fz;
      else if (back === "bottom") z = D - flushGap - fz;
      else if (back === "left") x = flushGap + fx;
      else x = W - flushGap - fx;
    }
    x = clamp(x, fx, W - fx);
    z = clamp(z, fz, D - fz);
    const n = (counts.get(t) ?? 0) + 1;
    counts.set(t, n);
    const variant = variantFrom(t, words) ?? defaultVariant(t, kindFinal);
    items.push({
      id: `${t}-${n}`,
      type: t,
      variant,
      x: round2(x),
      z: round2(z),
      w: round2(w),
      d: round2(d),
      h: t === "other" ? 0.8 : heightFor(t, variant),
      facing,
      ...(type ? {} : { label: label || "unit" }),
      ...(t === "artwork" ? { elevation: 1.3 } : t === "mirror" ? { elevation: 0.6 } : {}),
    });
  }
  if (dropped) warnings.push(`${dropped} symbol${dropped > 1 ? "s" : ""} on the plan could not be identified and became plain boxes — rename or delete them.`);

  // Side tables take the bed's facing, so they line up with its head.
  const bed = items.find((i) => i.type === "bed");
  if (bed) for (const it of items) if (it.type === "nightstand") it.facing = bed.facing;

  const style = "modern-warm" as const;
  const roomModel: RoomModel = {
    version: 1,
    name: (reading.room_name || hint.name || defaultName(kindFinal)).slice(0, 60),
    kind: kindFinal,
    width: W,
    depth: D,
    height: 3.0,
    falseCeiling: kindFinal !== "bathroom" && kindFinal !== "kitchen",
    curtains: true,
    floor: kindFinal === "bathroom" || kindFinal === "kitchen" ? "tile" : kindFinal === "living" || kindFinal === "dining" ? "marble" : "wood",
    wallColor: STYLES[style].wall,
    style,
    openings: uniq,
    items,
    scaleSource,
    plan: { ref: hint.planRef ?? "plan", imageW: IW, imageH: IH, box: [room.x0, room.z0, room.x1, room.z1].map((v) => Math.round(v * 10) / 10) as [number, number, number, number] },
  };
  const settled = settle(roomModel);
  if (!uniq.some((o) => o.kind !== "window")) warnings.push("No door was found on the plan — the entry view is taken from the bottom wall. Add the door in Room settings.");
  return { room: settled, warnings };
}

function defaultVariant(t: ItemType, kind: RoomKind): string {
  if (t === "wardrobe") return "hinged-loft";
  if (t === "tvUnit") return kind === "living" ? "panel" : "floating";
  return CATALOG[t].variants[0].id;
}

function heightFor(t: ItemType, _variant: string): number {
  return CATALOG[t].size.h;
}

function defaultName(kind: RoomKind): string {
  return { bedroom: "Bedroom", kids: "Kids room", living: "Living room", dining: "Dining", kitchen: "Kitchen", bathroom: "Bathroom", study: "Study", other: "Room" }[kind];
}
