// "Furnish it for me": a standard layout for an empty room, built with the
// same placement rules as typed commands (bed against the roomiest wall, bed
// back and side tables behind/beside it, TV unit facing it…). Used when the
// plan has no furniture drawn, or when the user starts from a blank room.

import type { ItemType, RoomKind, RoomModel } from "./types";
import { applyOps, type Op } from "./commands";
import { round2 } from "./geometry";

const LAYOUTS: Record<RoomKind, Op[]> = {
  bedroom: [
    { op: "add", type: "bed" },
    { op: "add", type: "bedBack" },
    { op: "add", type: "nightstand", count: 2 },
    { op: "add", type: "wardrobe", variant: "hinged-loft" },
    { op: "add", type: "tvUnit" },
    { op: "add", type: "rug" },
    { op: "add", type: "plant" },
    { op: "add", type: "ceilingFan" },
    { op: "add", type: "ac" },
  ],
  kids: [
    { op: "add", type: "bed", variant: "storage" },
    { op: "add", type: "nightstand", count: 1 },
    { op: "add", type: "wardrobe" },
    { op: "add", type: "desk" },
    { op: "add", type: "rug", variant: "round" },
    { op: "add", type: "ceilingFan" },
    { op: "add", type: "ac" },
  ],
  living: [
    { op: "add", type: "sofa" },
    { op: "add", type: "tvUnit", variant: "panel" },
    { op: "add", type: "coffeeTable" },
    { op: "add", type: "rug" },
    { op: "add", type: "armchair" },
    { op: "add", type: "sideTable" },
    { op: "add", type: "floorLamp" },
    { op: "add", type: "plant" },
    { op: "add", type: "artwork", variant: "triptych" },
    { op: "add", type: "ceilingFan" },
    { op: "add", type: "ac" },
  ],
  dining: [
    { op: "add", type: "diningSet" },
    { op: "add", type: "sideboard" },
    { op: "add", type: "artwork" },
    { op: "add", type: "plant" },
  ],
  kitchen: [
    { op: "add", type: "kitchenCounter" },
    { op: "add", type: "fridge" },
  ],
  bathroom: [
    { op: "add", type: "vanity" },
    { op: "add", type: "toilet" },
    { op: "add", type: "shower" },
  ],
  study: [
    { op: "add", type: "desk", variant: "shelves" },
    { op: "add", type: "bookshelf" },
    { op: "add", type: "armchair" },
    { op: "add", type: "rug" },
    { op: "add", type: "plant" },
    { op: "add", type: "ceilingFan" },
    { op: "add", type: "ac" },
  ],
  other: [
    { op: "add", type: "sofa" },
    { op: "add", type: "coffeeTable" },
    { op: "add", type: "rug" },
  ],
};

/** Add a standard furniture layout for the room's kind. Pieces that do not fit are skipped. */
export function autoFurnish(room: RoomModel): { room: RoomModel; added: number; skipped: ItemType[] } {
  let r = room;
  let added = 0;
  const skipped: ItemType[] = [];
  for (const op of LAYOUTS[room.kind] ?? LAYOUTS.other) {
    if (op.op === "add" && r.items.some((i) => i.type === op.type)) continue;
    const res = applyOps(r, [op]);
    if (res.changed) {
      added += res.room.items.length - r.items.length;
      r = res.room;
    } else if (op.op === "add") skipped.push(op.type);
  }
  return { room: r, added, skipped };
}

/** An empty room of a given size: one door in the bottom wall, one window opposite. */
export function blankRoom(kind: RoomKind, width: number, depth: number, name?: string): RoomModel {
  return {
    version: 1,
    name: name ?? { bedroom: "Bedroom", kids: "Kids room", living: "Living room", dining: "Dining", kitchen: "Kitchen", bathroom: "Bathroom", study: "Study", other: "Room" }[kind],
    kind,
    width,
    depth,
    height: 3.0,
    falseCeiling: kind !== "bathroom" && kind !== "kitchen",
    curtains: true,
    floor: kind === "bathroom" || kind === "kitchen" ? "tile" : kind === "living" || kind === "dining" ? "marble" : "wood",
    wallColor: "#ece6dc",
    style: "modern-warm",
    scaleSource: "manual",
    openings: [
      { id: "d1", kind: "door", wall: "bottom", offset: round2(Math.min(width - 0.6, Math.max(0.6, width * 0.8))), width: 0.9, height: 2.1, sill: 0, main: true },
      { id: "w1", kind: "window", wall: "top", offset: round2(width / 2), width: round2(Math.min(1.8, width - 0.8)), height: 1.35, sill: 0.9 },
    ],
    items: [],
  };
}
