// Where a new piece goes. Interior-design defaults, applied to the exact model:
// a bed back panel spans the wall behind the bed, side tables flank the bed's
// head, a TV unit faces the bed or sofa, a coffee table sits in front of the
// sofa, plants take a free corner. Nothing is placed over another piece, in a
// door's swing or (if it is tall) in front of a window.

import type { Dir, Item, ItemType, RoomModel, Wall } from "./types";
import { CATALOG } from "./catalog";
import {
  type Rect,
  WALLS,
  clamp,
  dirVec,
  facingAwayFrom,
  footprint,
  mainItem,
  opposite,
  rectsOverlap,
  round2,
  wallBehind,
  wallOfDir,
} from "./geometry";
import { FALSE_CEILING_DROP, WALL_CLEAR } from "./constants";

export { WALL_CLEAR };

export interface Placement {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  facing: Dir;
  elevation?: number;
}

/** Floor zones nothing may stand in: a door's swing, a sliding door's path. */
export function keepClearZones(room: RoomModel): Rect[] {
  const zones: Rect[] = [];
  for (const o of room.openings) {
    if (o.kind === "window") continue;
    const depth = o.kind === "door" ? Math.max(0.85, o.width) : 0.6;
    zones.push(zoneInFront(room, o.wall, o.offset, o.width + 0.1, depth));
  }
  return zones;
}

/** Zones in front of windows: tall pieces must not stand there. */
function windowZones(room: RoomModel): { rect: Rect; sill: number }[] {
  return room.openings
    .filter((o) => o.kind === "window")
    .map((o) => ({ rect: zoneInFront(room, o.wall, o.offset, o.width, 0.5), sill: o.sill }));
}

function zoneInFront(room: RoomModel, wall: Wall, offset: number, width: number, depth: number): Rect {
  switch (wall) {
    case "top":
      return { x0: offset - width / 2, x1: offset + width / 2, z0: 0, z1: depth };
    case "bottom":
      return { x0: offset - width / 2, x1: offset + width / 2, z0: room.depth - depth, z1: room.depth };
    case "left":
      return { x0: 0, x1: depth, z0: offset - width / 2, z1: offset + width / 2 };
    default:
      return { x0: room.width - depth, x1: room.width, z0: offset - width / 2, z1: offset + width / 2 };
  }
}

/** Footprints of everything standing on the floor (rugs and wall-hung pieces excluded). */
function standing(room: RoomModel, except: Set<string>): Rect[] {
  return room.items
    .filter((it) => !except.has(it.id))
    .filter((it) => !CATALOG[it.type].flat && !CATALOG[it.type].wallMounted)
    .map((it) => footprint(it));
}

/** How far from `wall` a piece must stand at `along` (clear of any panel hung there). */
export function wallGapAt(room: RoomModel, wall: Wall, a0: number, a1: number): number {
  let gap = WALL_CLEAR;
  for (const it of room.items) {
    if (!CATALOG[it.type].wallMounted || (it.elevation ?? 0) > 0.5) continue;
    if (wallOfDir(opposite(it.facing)) !== wall) continue;
    const r = footprint(it);
    const b0 = wall === "top" || wall === "bottom" ? r.x0 : r.z0;
    const b1 = wall === "top" || wall === "bottom" ? r.x1 : r.z1;
    if (b0 < a1 && b1 > a0) gap = Math.max(gap, it.d + 0.01);
  }
  return gap;
}

/**
 * Push pieces standing against a wall forward so they sit in front of a panel
 * hung on it (a bed back panel is 6 cm thick: the bed and side tables move out by that).
 */
export function settle(room: RoomModel): RoomModel {
  let changed = false;
  const items = room.items.map((it) => {
    const cat = CATALOG[it.type];
    if (cat.wallMounted || cat.flat) return it;
    const wall = wallOfDir(opposite(it.facing));
    const r = footprint(it);
    const horizontal = wall === "top" || wall === "bottom";
    const gapNow = wall === "top" ? r.z0 : wall === "bottom" ? room.depth - r.z1 : wall === "left" ? r.x0 : room.width - r.x1;
    if (gapNow > 0.2) return it;
    const need = wallGapAt(room, wall, horizontal ? r.x0 : r.z0, horizontal ? r.x1 : r.z1);
    if (gapNow >= need - 0.001) return it;
    const push = need - gapNow;
    const f = dirVec(it.facing);
    changed = true;
    return { ...it, x: round2(it.x + f[0] * push), z: round2(it.z + f[1] * push) };
  });
  return changed ? { ...room, items } : room;
}

/** Can a piece with this footprint and height go here? */
export function fits(room: RoomModel, r: Rect, h: number, except: Set<string> = new Set(), pad = 0.02): boolean {
  if (r.x0 < -0.001 || r.z0 < -0.001 || r.x1 > room.width + 0.001 || r.z1 > room.depth + 0.001) return false;
  if (standing(room, except).some((o) => rectsOverlap(o, r, -pad < 0 ? pad : pad) && overlapArea(o, r) > 0.0004)) return false;
  if (keepClearZones(room).some((z) => overlapArea(z, r) > 0.01)) return false;
  if (h > 0.95 && windowZones(room).some((wz) => h > wz.sill && overlapArea(wz.rect, r) > 0.01)) return false;
  return true;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}

export function wallLen(room: RoomModel, wall: Wall): number {
  return wall === "top" || wall === "bottom" ? room.width : room.depth;
}

/** Centre of a piece of depth `d` with its back on `wall`, at `along` (x for top/bottom, z for left/right). */
export function againstWallAt(room: RoomModel, wall: Wall, along: number, d: number, gap = WALL_CLEAR): { x: number; z: number; facing: Dir } {
  const facing = facingAwayFrom(wall);
  switch (wall) {
    case "top":
      return { x: along, z: gap + d / 2, facing };
    case "bottom":
      return { x: along, z: room.depth - gap - d / 2, facing };
    case "left":
      return { x: gap + d / 2, z: along, facing };
    default:
      return { x: room.width - gap - d / 2, z: along, facing };
  }
}

/**
 * Slide a piece along a wall to the free spot nearest `prefer` (default: the
 * middle). Returns null if the wall has no room for it.
 */
export function fitOnWall(
  room: RoomModel,
  wall: Wall,
  size: { w: number; d: number; h: number },
  opts: { prefer?: number; except?: Set<string>; gap?: number } = {},
): Placement | null {
  const L = wallLen(room, wall);
  if (size.w > L) return null;
  const prefer = opts.prefer ?? L / 2;
  const cands: number[] = [];
  for (let a = size.w / 2; a <= L - size.w / 2 + 1e-6; a += 0.05) cands.push(a);
  cands.sort((p, q) => Math.abs(p - prefer) - Math.abs(q - prefer));
  for (const a of cands) {
    const gap = opts.gap ?? wallGapAt(room, wall, a - size.w / 2, a + size.w / 2);
    const c = againstWallAt(room, wall, a, size.d, gap);
    const r = footprint({ ...c, w: size.w, d: size.d });
    if (fits(room, r, size.h, opts.except)) return { ...c, ...size, x: round2(c.x), z: round2(c.z) };
  }
  return null;
}

/** The free floor spot nearest `prefer` for a free-standing piece, keeping a walkway around it. */
export function fitFree(
  room: RoomModel,
  size: { w: number; d: number; h: number },
  prefer: [number, number],
  facing: Dir,
  opts: { except?: Set<string>; walkway?: number } = {},
): Placement | null {
  const walk = opts.walkway ?? 0.25;
  const sideways = facing === "left" || facing === "right";
  const ex = (sideways ? size.d : size.w) / 2;
  const ez = (sideways ? size.w : size.d) / 2;
  const cands: [number, number][] = [];
  for (let x = ex; x <= room.width - ex + 1e-6; x += 0.05) for (let z = ez; z <= room.depth - ez + 1e-6; z += 0.05) cands.push([x, z]);
  cands.sort((a, b) => Math.hypot(a[0] - prefer[0], a[1] - prefer[1]) - Math.hypot(b[0] - prefer[0], b[1] - prefer[1]));
  for (const [x, z] of cands) {
    const r = { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez };
    const padded = { x0: r.x0 - walk, x1: r.x1 + walk, z0: r.z0 - walk, z1: r.z1 + walk };
    const inside = { x0: Math.max(0, padded.x0), x1: Math.min(room.width, padded.x1), z0: Math.max(0, padded.z0), z1: Math.min(room.depth, padded.z1) };
    if (fits(room, r, size.h, opts.except) && fits(room, inside, 0, opts.except, 0)) return { x: round2(x), z: round2(z), ...size, facing };
  }
  return null;
}

/** Walls ordered by how much free run they have, longest first (door wall last). */
function wallsBySpace(room: RoomModel): Wall[] {
  const doorWalls = new Set(room.openings.filter((o) => o.kind !== "window").map((o) => o.wall));
  return [...WALLS].sort((a, b) => {
    const da = doorWalls.has(a) ? 1 : 0;
    const db = doorWalls.has(b) ? 1 : 0;
    return da - db || wallLen(room, b) - wallLen(room, a);
  });
}

function ceilingClear(room: RoomModel): number {
  return room.falseCeiling ? room.height - FALSE_CEILING_DROP : room.height;
}

/** Default size of a new piece, adjusted to what it goes with. */
function sizeFor(room: RoomModel, type: ItemType, variant: string): { w: number; d: number; h: number } {
  const s = { ...CATALOG[type].size };
  if (type === "sofa" && variant === "l-shape") s.d = 1.6;
  if (type === "wardrobe" && variant === "hinged-loft") s.h = Math.min(ceilingClear(room) - 0.02, 2.7);
  if (type === "tvUnit" && variant === "panel") s.h = 0.45;
  return s;
}

/**
 * A good spot for a new piece of `type`. `near` is the piece it belongs to
 * (the bed for side tables and bed backs, the sofa for a coffee table), `wall`
 * forces a wall. Returns one placement, or two for "side tables" (one each side).
 */
export function placeNew(
  room: RoomModel,
  type: ItemType,
  variant: string,
  opts: { near?: Item | null; wall?: Wall | null; count?: number } = {},
): Placement[] {
  const size = sizeFor(room, type, variant);
  const main = mainItem(room);
  const bed = opts.near?.type === "bed" ? opts.near : room.items.find((i) => i.type === "bed") ?? null;
  const sofa = opts.near?.type === "sofa" ? opts.near : room.items.find((i) => i.type === "sofa") ?? null;
  const out: Placement[] = [];

  if (opts.wall && type !== "bedBack" && type !== "artwork" && type !== "mirror") {
    const p = CATALOG[type].againstWall ? fitOnWall(room, opts.wall, size) : fitFree(room, size, centreNearWall(room, opts.wall, 1.2), facingAwayFrom(opts.wall));
    return p ? [p] : [];
  }

  switch (type) {
    case "bedBack": {
      const wall = opts.wall ?? (bed ? wallBehind(room, bed, 0.6) ?? wallOfDir(opposite(bed.facing)) : wallsBySpace(room)[0]);
      const L = wallLen(room, wall);
      const centre = bed ? (wall === "top" || wall === "bottom" ? bed.x : bed.z) : L / 2;
      const w = Math.min(L - 0.1, bed ? bed.w + 1.6 : 3.0);
      const along = clamp(centre, w / 2 + 0.05, L - w / 2 - 0.05);
      const h = Math.min(2.4, ceilingClear(room) - 0.05);
      const c = againstWallAt(room, wall, along, 0.06, 0.0);
      return [{ x: round2(c.x), z: round2(c.z), w: round2(w), d: 0.06, h, facing: c.facing }];
    }
    case "nightstand": {
      if (bed) {
        const f = dirVec(bed.facing);
        const side: [number, number] = [-f[1], f[0]]; // the bed's right-hand side, in plan
        const head = wallBehind(room, bed, 0.6);
        const wall = head ?? wallOfDir(opposite(bed.facing));
        const existing = room.items.filter((i) => i.type === "nightstand");
        for (const s of [1, -1]) {
          const along0 = wall === "top" || wall === "bottom" ? bed.x + side[0] * s * (bed.w / 2 + 0.05 + size.w / 2) : bed.z + side[1] * s * (bed.w / 2 + 0.05 + size.w / 2);
          const bedGap = wall === "top" ? footprint(bed).z0 : wall === "bottom" ? room.depth - footprint(bed).z1 : wall === "left" ? footprint(bed).x0 : room.width - footprint(bed).x1;
          const c = againstWallAt(room, wall, along0, size.d, head ? Math.max(WALL_CLEAR, Math.min(bedGap, 0.3)) : WALL_CLEAR);
          const r = footprint({ ...c, ...size });
          const taken = existing.some((e) => rectsOverlap(footprint(e), r, 0.05));
          if (!taken && fits(room, r, size.h)) out.push({ ...c, ...size, x: round2(c.x), z: round2(c.z) });
          if (out.length >= (opts.count ?? 2)) break;
        }
        if (out.length) return out;
      }
      break;
    }
    case "tvUnit": {
      const anchor = bed ?? sofa ?? main;
      if (anchor) {
        const wall = wallOfDir(anchor.facing);
        const prefer = wall === "top" || wall === "bottom" ? anchor.x : anchor.z;
        const p = fitOnWall(room, wall, { ...size, w: Math.min(size.w, wallLen(room, wall) - 0.6) }, { prefer });
        if (p) return [p];
      }
      break;
    }
    case "wardrobe":
    case "dresser":
    case "bookshelf": {
      if (bed) {
        // Never on the bed's head wall or the wall it faces (that is the TV wall):
        // on a side wall, tucked into a corner, foot-end corner first.
        const head = wallOfDir(opposite(bed.facing));
        const sides = WALLS.filter((w) => w !== head && w !== wallOfDir(bed.facing));
        const f = dirVec(bed.facing);
        for (const w of sides) {
          const L = wallLen(room, w);
          const footAlong = w === "top" || w === "bottom" ? bed.x + f[0] * bed.d : bed.z + f[1] * bed.d;
          const ends = [size.w / 2, L - size.w / 2].sort((a, b) => Math.abs(a - footAlong) - Math.abs(b - footAlong));
          for (const prefer of ends) {
            const p = fitOnWall(room, w, size, { prefer });
            if (p && Math.abs((w === "top" || w === "bottom" ? p.x : p.z) - prefer) < 0.6) return [p];
          }
        }
        for (const w of sides) {
          const p = fitOnWall(room, w, size);
          if (p) return [p];
        }
      }
      break;
    }
    case "sofa": {
      const tv = room.items.find((i) => i.type === "tvUnit");
      const walls = tv ? [wallOfDir(tv.facing), ...wallsBySpace(room)] : wallsBySpace(room);
      for (const w of walls) {
        const p = fitOnWall(room, w, size, { prefer: tv ? (w === "top" || w === "bottom" ? tv.x : tv.z) : undefined });
        if (p) return [p];
      }
      break;
    }
    case "coffeeTable": {
      if (sofa) {
        const f = dirVec(sofa.facing);
        const reach = sofa.d / 2 + 0.45 + size.d / 2;
        const p = fitFree(room, size, [sofa.x + f[0] * reach, sofa.z + f[1] * reach], sofa.facing, { walkway: 0.1 });
        if (p) return [p];
      }
      break;
    }
    case "armchair": {
      const ct = room.items.find((i) => i.type === "coffeeTable");
      const anchor = ct ?? sofa;
      if (anchor) {
        const f = dirVec(anchor.facing);
        // To the side of the seating group, turned to face across it.
        const side: [number, number] = [-f[1], f[0]];
        for (const s of [1, -1]) {
          const reach = anchor.w / 2 + 0.25 + size.d / 2;
          const facing = dirFromVec([-side[0] * s, -side[1] * s]);
          const p = fitFree(room, size, [anchor.x + side[0] * s * reach, anchor.z + side[1] * s * reach], facing, { walkway: 0.15 });
          if (p) return [p];
        }
      }
      break;
    }
    case "rug": {
      if (bed) {
        const f = dirVec(bed.facing);
        const w = Math.min(bed.w + 0.9, room.width - 0.3);
        const d = Math.min(1.8, bed.d * 0.75);
        return [{ x: round2(bed.x + f[0] * bed.d * 0.25), z: round2(bed.z + f[1] * bed.d * 0.25), w: round2(w), d: round2(d), h: 0.012, facing: bed.facing }];
      }
      if (sofa) {
        const f = dirVec(sofa.facing);
        return [{ x: round2(sofa.x + f[0] * (sofa.d / 2 + 0.75)), z: round2(sofa.z + f[1] * (sofa.d / 2 + 0.75)), w: Math.min(2.6, sofa.w + 0.2), d: 1.8, h: 0.012, facing: sofa.facing }];
      }
      return [{ x: round2(room.width / 2), z: round2(room.depth / 2), w: Math.min(size.w, room.width - 0.6), d: Math.min(size.d, room.depth - 0.6), h: 0.012, facing: "down" }];
    }
    case "artwork":
    case "mirror": {
      const over = type === "artwork" ? sofa ?? bed : null;
      if (over && !opts.wall) {
        const wall = wallBehind(room, over, 0.4);
        if (wall) {
          const c = againstWallAt(room, wall, wall === "top" || wall === "bottom" ? over.x : over.z, size.d, 0);
          const top = over.type === "bed" ? over.h : over.h;
          return [{ x: round2(c.x), z: round2(c.z), ...size, w: Math.min(size.w, over.w * 0.75), facing: c.facing, elevation: round2(Math.max(1.2, top + 0.25)) }];
        }
      }
      const walls = opts.wall ? [opts.wall] : wallsBySpace(room);
      for (const w of walls) {
        // Hang it where nothing tall stands against that stretch of wall.
        const p = fitOnWall(room, w, { ...size, d: 0.3, h: 2.0 }, { gap: 0 });
        if (p) {
          const c = againstWallAt(room, w, w === "top" || w === "bottom" ? p.x : p.z, size.d, 0);
          return [{ x: round2(c.x), z: round2(c.z), ...size, facing: c.facing, elevation: type === "mirror" ? 0.6 : 1.3 }];
        }
      }
      break;
    }
    case "bench":
    case "ottoman": {
      if (type === "bench" && bed) {
        const f = dirVec(bed.facing);
        const reach = bed.d / 2 + 0.05 + size.d / 2;
        const p = fitFree(room, { ...size, w: Math.min(size.w, bed.w - 0.3) }, [bed.x + f[0] * reach, bed.z + f[1] * reach], bed.facing, { walkway: 0 });
        if (p) return [p];
      }
      const ct = room.items.find((i) => i.type === "coffeeTable");
      if (ct) {
        const f = dirVec(ct.facing);
        const p = fitFree(room, size, [ct.x + f[0] * (ct.d / 2 + 0.4), ct.z + f[1] * (ct.d / 2 + 0.4)], opposite(ct.facing), { walkway: 0.1 });
        if (p) return [p];
      }
      break;
    }
    case "sideTable": {
      if (sofa) {
        const f = dirVec(sofa.facing);
        const side: [number, number] = [-f[1], f[0]];
        for (const s of [1, -1]) {
          const reach = sofa.w / 2 + 0.05 + size.w / 2;
          const p = fitFree(room, size, [sofa.x + side[0] * s * reach, sofa.z + side[1] * s * reach], sofa.facing, { walkway: 0 });
          if (p) return [p];
        }
      }
      break;
    }
    case "plant":
    case "floorLamp": {
      const corners: [number, number][] = [
        [0.35, 0.35],
        [room.width - 0.35, 0.35],
        [room.width - 0.35, room.depth - 0.35],
        [0.35, room.depth - 0.35],
      ];
      const anchor = type === "floorLamp" ? sofa ?? bed : null;
      if (anchor) {
        const f = dirVec(anchor.facing);
        const side: [number, number] = [-f[1], f[0]];
        for (const s of [1, -1]) {
          const reach = anchor.w / 2 + 0.3;
          const p = fitFree(room, size, [anchor.x + side[0] * s * reach - f[0] * anchor.d * 0.3, anchor.z + side[1] * s * reach - f[1] * anchor.d * 0.3], anchor.facing, { walkway: 0 });
          if (p) return [p];
        }
      }
      for (const c of corners) {
        const p = fitFree(room, size, c, "down", { walkway: 0 });
        if (p && Math.hypot(p.x - c[0], p.z - c[1]) < 0.6) return [p];
      }
      break;
    }
    case "chair": {
      const desk = room.items.find((i) => i.type === "desk" || i.type === "dresser");
      if (desk) {
        const f = dirVec(desk.facing);
        const reach = desk.d / 2 + 0.15;
        const p = fitFree(room, size, [desk.x + f[0] * reach, desk.z + f[1] * reach], opposite(desk.facing), { walkway: 0 });
        if (p) return [p];
      }
      break;
    }
    case "diningSet": {
      const p = fitFree(room, size, [room.width / 2, room.depth / 2], room.width >= room.depth ? "down" : "right", { walkway: 0.75 });
      if (p) return [p];
      break;
    }
    default:
      break;
  }

  // Generic fallback: against the roomiest wall, or the freest floor spot.
  if (CATALOG[type].againstWall) {
    for (const w of wallsBySpace(room)) {
      const p = fitOnWall(room, w, size);
      if (p) return [p];
    }
  }
  const p = fitFree(room, size, [room.width / 2, room.depth / 2], main ? opposite(main.facing) : "down", { walkway: 0.2 });
  return p ? [p] : [];
}

function centreNearWall(room: RoomModel, wall: Wall, inset: number): [number, number] {
  switch (wall) {
    case "top":
      return [room.width / 2, inset];
    case "bottom":
      return [room.width / 2, room.depth - inset];
    case "left":
      return [inset, room.depth / 2];
    default:
      return [room.width - inset, room.depth / 2];
  }
}

export function dirFromVec(v: [number, number]): Dir {
  if (Math.abs(v[0]) >= Math.abs(v[1])) return v[0] >= 0 ? "right" : "left";
  return v[1] >= 0 ? "down" : "up";
}

/** A fresh id like "nightstand-3". */
export function newId(room: RoomModel, type: ItemType): string {
  const used = new Set(room.items.map((i) => i.id));
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Keep a piece inside the room after a move/resize. */
export function clampInside(room: RoomModel, it: Item): Item {
  const r = footprint(it);
  const dx = r.x0 < 0 ? -r.x0 : r.x1 > room.width ? room.width - r.x1 : 0;
  const dz = r.z0 < 0 ? -r.z0 : r.z1 > room.depth ? room.depth - r.z1 : 0;
  return { ...it, x: round2(it.x + dx), z: round2(it.z + dz) };
}

/** After a room edit (size, doors): keep every piece and opening inside, panels respected. */
export function normalizeRoom(room: RoomModel): RoomModel {
  const openings = room.openings.map((o) => {
    const L = wallLen(room, o.wall);
    const width = Math.min(o.width, L - 0.1);
    return { ...o, width, offset: round2(clamp(o.offset, width / 2, L - width / 2)) };
  });
  const r = { ...room, openings };
  return settle({ ...r, items: r.items.map((it) => clampInside(r, it)) });
}
