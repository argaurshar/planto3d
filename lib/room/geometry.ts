// Plan geometry over a RoomModel: footprints, which wall a piece backs onto,
// the main door, the room's main piece. Pure functions, no three.js.

import type { CeilingDesign, Dir, Item, ItemType, Opening, RoomModel, Wall } from "./types";
import { CATALOG, MAIN_ITEM_ORDER } from "./catalog";
import { FALSE_CEILING_DROP } from "./constants";

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
  return [...room.items].filter((i) => onFloor(i.type)).sort((a, b) => b.w * b.d - a.w * a.d)[0] ?? null;
}

/** Items hung on (or standing flush against) a wall: hidden with that wall in clip shots. */
export function itemsAgainst(room: RoomModel, wall: Wall, tol = 0.12, onlyWallMounted = false): Item[] {
  return room.items.filter((it) => {
    if (onlyWallMounted && !CATALOG[it.type].wallMounted) return false;
    if (CATALOG[it.type].flat || CATALOG[it.type].ceilingMounted) return false;
    return wallBehind(room, it, tol) === wall;
  });
}

/** A piece that stands on the floor: not a rug, not hung on a wall or from the ceiling. */
export function onFloor(type: ItemType): boolean {
  const c = CATALOG[type];
  return !c.flat && !c.wallMounted && !c.ceilingMounted;
}

/** Width of the false ceiling's perimeter band; inside it the true ceiling is open. */
export function falseCeilingBand(room: Pick<RoomModel, "width" | "depth">): number {
  return Math.min(0.65, Math.min(room.width, room.depth) * 0.18);
}

export const CEILING_DESIGNS: CeilingDesign[] = ["cove", "island", "slats"];

export function ceilingDesignOf(room: Pick<RoomModel, "ceilingDesign">): CeilingDesign {
  return room.ceilingDesign && CEILING_DESIGNS.includes(room.ceilingDesign) ? room.ceilingDesign : "cove";
}

/** How far a floating ceiling island hangs below the true ceiling (its underside). */
export const ISLAND_DROP = 0.22;
/** Underside of a wooden slat ceiling below the true ceiling. */
export const SLAT_DROP = 0.07;

/** The floating island of an "island" false ceiling, inset from the walls. */
export function islandRect(room: Pick<RoomModel, "width" | "depth">): Rect {
  // A wide margin, so the lit ceiling around the raft shows from the room.
  const inset = clamp(Math.min(room.width, room.depth) * 0.24, 0.6, 1.2);
  return { x0: inset, x1: room.width - inset, z0: inset, z1: room.depth - inset };
}

/** Height of the ceiling surface over a plan point (band, island, slats or the true ceiling). */
export function ceilingAt(room: RoomModel, x: number, z: number): number {
  if (!room.falseCeiling) return room.height;
  const design = ceilingDesignOf(room);
  if (design === "island") {
    const r = islandRect(room);
    return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 ? room.height - ISLAND_DROP : room.height;
  }
  const b = falseCeilingBand(room);
  if (x < b || z < b || x > room.width - b || z > room.depth - b) return room.height - FALSE_CEILING_DROP;
  return design === "slats" ? room.height - SLAT_DROP : room.height;
}

/** Ceiling height along the walls, where wardrobes, wall panels and an AC meet it. */
export function wallCeiling(room: RoomModel): number {
  return room.falseCeiling && ceilingDesignOf(room) !== "island" ? room.height - FALSE_CEILING_DROP : room.height;
}

/** Lowest clear height under a ceiling fan's blades (2.1 m is the legal minimum; 2.3 m feels right). */
export const FAN_CLEAR = 2.3;

/** How far a ceiling piece hangs down: its drop, shortened so a fan's blades stay above head height. */
export function ceilingDrop(room: RoomModel, it: Item): number {
  return clamp(it.h, 0.2, Math.max(0.2, ceilingAt(room, it.x, it.z) - FAN_CLEAR));
}

/** Bottom and top of a piece above the floor. */
export function verticalSpan(room: RoomModel, it: Item): [number, number] {
  if (CATALOG[it.type].ceilingMounted) {
    const c = ceilingAt(room, it.x, it.z);
    return [c - ceilingDrop(room, it), c];
  }
  const y0 = it.elevation ?? 0;
  return [y0, y0 + it.h];
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
