// Plan geometry over a RoomModel: footprints, which wall a piece backs onto,
// the main door, the room's main piece. Pure functions, no three.js.

import type { Dir, Item, Opening, RoomModel, Wall } from "./types";
import { CATALOG, MAIN_ITEM_ORDER } from "./catalog";

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const DIRS: Dir[] = ["up", "down", "left", "right"];
export const WALLS: Wall[] = ["top", "bottom", "left", "right"];

/** Unit vector of a plan direction (z grows downward). */
export function dirVec(d: Dir): [number, number] {
  switch (d) {
    case "up":
      return [0, -1];
    case "down":
      return [0, 1];
    case "left":
      return [-1, 0];
    default:
      return [1, 0];
  }
}

export function opposite(d: Dir): Dir {
  return d === "up" ? "down" : d === "down" ? "up" : d === "left" ? "right" : "left";
}

/** The wall you reach going in direction `d` from inside the room. */
export function wallOfDir(d: Dir): Wall {
  return d === "up" ? "top" : d === "down" ? "bottom" : d;
}

/** The direction from the room towards a wall. */
export function dirOfWall(w: Wall): Dir {
  return w === "top" ? "up" : w === "bottom" ? "down" : w;
}

/** Facing that puts a piece's back against `wall` (its front looks into the room). */
export function facingAwayFrom(wall: Wall): Dir {
  return opposite(dirOfWall(wall));
}

/** Plan extents of an item's footprint. */
export function footprint(it: Pick<Item, "x" | "z" | "w" | "d" | "facing">): Rect {
  const sideways = it.facing === "left" || it.facing === "right";
  const ex = (sideways ? it.d : it.w) / 2;
  const ez = (sideways ? it.w : it.d) / 2;
  return { x0: it.x - ex, x1: it.x + ex, z0: it.z - ez, z1: it.z + ez };
}

/** Distance from a footprint edge to a wall. */
export function gapToWall(room: RoomModel, r: Rect, wall: Wall): number {
  switch (wall) {
    case "top":
      return r.z0;
    case "bottom":
      return room.depth - r.z1;
    case "left":
      return r.x0;
    default:
      return room.width - r.x1;
  }
}

/** The wall an item's back is against (within `tol` metres), or null. */
export function wallBehind(room: RoomModel, it: Item, tol = 0.35): Wall | null {
  const w = wallOfDir(opposite(it.facing));
  return gapToWall(room, footprint(it), w) <= tol ? w : null;
}

/** Nearest wall to a footprint and its gap. */
export function nearestWall(room: RoomModel, r: Rect): { wall: Wall; gap: number } {
  let best: { wall: Wall; gap: number } = { wall: "top", gap: Infinity };
  for (const w of WALLS) {
    const gap = gapToWall(room, r, w);
    if (gap < best.gap) best = { wall: w, gap };
  }
  return best;
}

/** Position along a wall (its offset axis) of a plan point. */
export function alongWall(wall: Wall, x: number, z: number): number {
  return wall === "top" || wall === "bottom" ? x : z;
}

export function mainDoor(room: RoomModel): Opening | null {
  const doors = room.openings.filter((o) => o.kind === "door");
  return doors.find((o) => o.main) ?? doors[0] ?? room.openings.find((o) => o.kind === "opening") ?? room.openings.find((o) => o.kind === "sliding") ?? null;
}

/** The piece a room is "about": bed, sofa, dining table… (largest of the first type present). */
export function mainItem(room: RoomModel): Item | null {
  for (const type of MAIN_ITEM_ORDER[room.kind] ?? MAIN_ITEM_ORDER.other) {
    const found = room.items.filter((i) => i.type === type).sort((a, b) => b.w * b.d - a.w * a.d);
    if (found.length) return found[0];
  }
  return [...room.items].filter((i) => !CATALOG[i.type].flat && !CATALOG[i.type].wallMounted).sort((a, b) => b.w * b.d - a.w * a.d)[0] ?? null;
}

/** Items hung on (or standing flush against) a wall: hidden with that wall in clip shots. */
export function itemsAgainst(room: RoomModel, wall: Wall, tol = 0.12, onlyWallMounted = false): Item[] {
  return room.items.filter((it) => {
    if (onlyWallMounted && !CATALOG[it.type].wallMounted) return false;
    if (CATALOG[it.type].flat) return false;
    return wallBehind(room, it, tol) === wall;
  });
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** "3.66 × 4.27 m (12′0″ × 14′0″)" */
export function formatSize(w: number, d: number): string {
  const ft = (m: number) => {
    const inches = Math.round(m / 0.0254);
    return `${Math.floor(inches / 12)}′${inches % 12}″`;
  };
  return `${w.toFixed(2)} × ${d.toFixed(2)} m (${ft(w)} × ${ft(d)})`;
}
