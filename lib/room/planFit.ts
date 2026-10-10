// The room on its plan: where the model sits on the uploaded drawing, and the
// edits that keep the two in step. The plan check view draws the model over
// the plan with these mappings, and every correction made there (re-fitting
// the walls, dragging a door along its wall) comes back here as a new model,
// so it goes through the undo history like any other edit.

import type { Item, Opening, PlanFit, RoomModel, Wall } from "./types";
import { clamp, footprint, round2 } from "./geometry";
import { normalizeRoom, wallLen } from "./place";

/** A piece this close to a wall is "against" it and stays flush when the walls move. */
const FLUSH = 0.15;

/** Plan metres → image pixels. */
export function toPlan(room: RoomModel, fit: PlanFit, x: number, z: number): [number, number] {
  const [x0, y0, x1, y1] = fit.box;
  return [x0 + (x / room.width) * (x1 - x0), y0 + (z / room.depth) * (y1 - y0)];
}

/** Image pixels → plan metres. */
export function fromPlan(room: RoomModel, fit: PlanFit, px: number, py: number): [number, number] {
  const [x0, y0, x1, y1] = fit.box;
  return [((px - x0) / (x1 - x0)) * room.width, ((py - y0) / (y1 - y0)) * room.depth];
}

/** The centre of an opening in plan metres (on the inner face of its wall). */
export function openingCentre(room: RoomModel, o: Opening): [number, number] {
  switch (o.wall) {
    case "top":
      return [o.offset, 0];
    case "bottom":
      return [o.offset, room.depth];
    case "left":
      return [0, o.offset];
    default:
      return [room.width, o.offset];
  }
}

/**
 * Re-place a piece along one axis when the walls move: a piece against the
 * low or high wall keeps its gap to that wall, anything else goes where `map`
 * sends its centre.
 */
function remapAxis(c: number, half: number, L: number, L2: number, map: (v: number) => number): number {
  if (c - half <= FLUSH) return c;
  if (L - (c + half) <= FLUSH) return L2 - (L - c);
  return map(c);
}

function remapItems(room: RoomModel, W2: number, D2: number, mx: (v: number) => number, mz: (v: number) => number): Item[] {
  return room.items.map((it) => {
    const r = footprint(it);
    const hx = (r.x1 - r.x0) / 2;
    const hz = (r.z1 - r.z0) / 2;
    return { ...it, x: round2(remapAxis(it.x, hx, room.width, W2, mx)), z: round2(remapAxis(it.z, hz, room.depth, D2, mz)) };
  });
}

/**
 * Set the room's inside size. Pieces against a wall stay flush with it. A room
 * read from a plan is being corrected, not extended, so everything else keeps
 * its place on the drawing (positions scale with the room); a room without a
 * plan keeps its positions in metres.
 */
export function resizeRoom(room: RoomModel, width: number, depth: number): RoomModel {
  const W2 = round2(clamp(width, 1.2, 20));
  const D2 = round2(clamp(depth, 1.2, 20));
  if (W2 === room.width && D2 === room.depth) return room;
  const kx = room.plan ? W2 / room.width : 1;
  const kz = room.plan ? D2 / room.depth : 1;
  const items = remapItems(room, W2, D2, (v) => v * kx, (v) => v * kz);
  const openings = room.openings.map((o) => ({ ...o, offset: round2(o.offset * (o.wall === "top" || o.wall === "bottom" ? kx : kz)) }));
  return normalizeRoom({ ...room, width: W2, depth: D2, items, openings, scaleSource: "manual" });
}

/**
 * Move the walls on the plan (the room was read slightly off the drawing's
 * wall lines). Doors, windows and loose pieces keep their place on the
 * drawing; pieces against a wall stay flush with it. A printed or typed size
 * is kept (the scale was wrong); an estimated one keeps its scale (the size
 * was wrong).
 */
export function refitPlan(room: RoomModel, box: PlanFit["box"]): RoomModel {
  const fit = room.plan;
  if (!fit) return room;
  const nb: PlanFit["box"] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];
  if (nb[2] - nb[0] < 8 || nb[3] - nb[1] < 8) return room;
  const keepScale = room.scaleSource === "estimated";
  const W2 = round2(clamp(keepScale ? (room.width * (nb[2] - nb[0])) / (fit.box[2] - fit.box[0]) : room.width, 1.2, 20));
  const D2 = round2(clamp(keepScale ? (room.depth * (nb[3] - nb[1])) / (fit.box[3] - fit.box[1]) : room.depth, 1.2, 20));
  const next: RoomModel = { ...room, width: W2, depth: D2, plan: { ...fit, box: nb } };
  // Metres in the old fit → pixels → metres in the new one.
  const mx = (x: number) => fromPlan(next, next.plan!, toPlan(room, fit, x, 0)[0], 0)[0];
  const mz = (z: number) => fromPlan(next, next.plan!, 0, toPlan(room, fit, 0, z)[1])[1];
  const items = remapItems(room, W2, D2, mx, mz);
  const openings = room.openings.map((o) => ({ ...o, offset: round2(o.wall === "top" || o.wall === "bottom" ? mx(o.offset) : mz(o.offset)) }));
  return normalizeRoom({ ...next, items, openings });
}

/** The wall nearest a plan point, and the point's position along it. */
export function nearestWallAt(room: RoomModel, x: number, z: number): { wall: Wall; offset: number } {
  const d: [Wall, number][] = [
    ["top", Math.abs(z)],
    ["bottom", Math.abs(room.depth - z)],
    ["left", Math.abs(x)],
    ["right", Math.abs(room.width - x)],
  ];
  const wall = d.sort((a, b) => a[1] - b[1])[0][0];
  return { wall, offset: wall === "top" || wall === "bottom" ? x : z };
}

/** Drag a door or window to a plan point: onto the nearest wall, centred there. */
export function placeOpening(room: RoomModel, id: string, x: number, z: number): RoomModel {
  const o = room.openings.find((p) => p.id === id);
  if (!o) return room;
  const { wall, offset } = nearestWallAt(room, x, z);
  const L = wallLen(room, wall);
  const width = Math.min(o.width, L - 0.1);
  const moved: Opening = { ...o, wall, width, offset: round2(clamp(offset, width / 2 + 0.05, L - width / 2 - 0.05)) };
  return normalizeRoom({ ...room, openings: room.openings.map((p) => (p.id === id ? moved : p)) });
}
