// Camera positions a room is photographed from, computed from the model.
//
// Interior-photography rules: the camera is LEVEL at standing eye height so
// vertical lines stay vertical (two-point perspective), and framing is done
// with lens shift instead of tilting. When the camera must stand where a wall
// is (behind the bed's head, behind a sofa against a wall) the wall and what
// hangs on it are clipped away — the "clipping camera" of every 3D renderer.

import type { Item, RoomModel, Shot, Wall } from "./types";
import { CATALOG, itemLabel } from "./catalog";
import { clamp, dirVec, footprint, itemsAgainst, mainDoor, mainItem, opposite, wallBehind, wallOfDir } from "./geometry";
import { openingCentre } from "./shell";

export const EYE = 1.55;
/** Vertical FOV for a 4:3 frame ≈ a 22 mm lens on full frame (80° horizontal). */
const FOV = 62;
/** How far behind a clipped wall the camera stands. */
const CLIP_BACK = 0.45;

/**
 * Names to hide when the camera stands behind `wall`: the wall itself and what
 * hangs on it; with `standing`, also every piece standing against it (it would
 * sit right in front of the lens).
 */
function hideWall(room: RoomModel, wall: Wall, standing = false): string[] {
  const items = standing ? itemsAgainst(room, wall, 0.75) : itemsAgainst(room, wall, 0.2, true);
  return [`wall:${wall}`, ...items.map((i) => `item:${i.id}`)];
}

/** Point just inside a wall at a position along it. */
function onWall(room: RoomModel, wall: Wall, along: number, inset: number): [number, number] {
  switch (wall) {
    case "top":
      return [along, inset];
    case "bottom":
      return [along, room.depth - inset];
    case "left":
      return [inset, along];
    default:
      return [room.width - inset, along];
  }
}

function level(pos: [number, number], target: [number, number], y = EYE): { pos: Shot["pos"]; target: Shot["target"] } {
  return { pos: [pos[0], y, pos[1]], target: [target[0], y, target[1]] };
}

/** Bottom edge of the frame below the horizon, for a level camera with lens shift. */
function lowerEdgeSlope(fov: number, shiftY: number): number {
  return Math.tan(((fov / 2) * Math.PI) / 180) * (1 - shiftY);
}

/** Distance from a plan point to an item's footprint (0 inside it). */
function distToItem(it: Item, x: number, z: number): number {
  const r = footprint(it);
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/**
 * Could a person stand here with a camera? Not on (or within a hand of) any
 * piece of furniture, and not with a tall piece right in front of the lens.
 */
function standable(room: RoomModel, x: number, z: number, tallClearance = 0.2): boolean {
  if (x < 0.25 || z < 0.25 || x > room.width - 0.25 || z > room.depth - 0.25) return false;
  return room.items.every((it) => {
    const cat = CATALOG[it.type];
    if (cat.flat || (cat.wallMounted && (it.elevation ?? 0) > 1.0)) return true;
    const d = distToItem(it, x, z);
    return d >= (it.h >= 1.0 ? tallClearance : 0.15);
  });
}

function entryShot(room: RoomModel, main: Item | null): Shot {
  const door = mainDoor(room);
  const cx = room.width / 2;
  const cz = room.depth / 2;
  if (!door) {
    const p = level([cx, room.depth + CLIP_BACK], [cx, 0]);
    return { id: "entry", label: "Entry view", ...p, fov: FOV, shiftY: -0.12, hide: hideWall(room, "bottom", true), note: "No door on the plan: taken from the bottom wall." };
  }
  const c = openingCentre(room, door);
  // Half a step past the threshold: where a person stands as they walk in.
  const pos: [number, number] = [c.x + c.nx * 0.5, c.z + c.nz * 0.5];
  // Look at a point between the room's centre and its main piece, pushed deep into the room.
  const fx = main ? (main.x + cx) / 2 : cx;
  const fz = main ? (main.z + cz) / 2 : cz;
  const dx = fx - pos[0];
  const dz = fz - pos[1];
  const len = Math.hypot(dx, dz) || 1;
  const target: [number, number] = [pos[0] + (dx / len) * 6, pos[1] + (dz / len) * 6];
  const small = Math.max(room.width, room.depth) < 4.2;
  return {
    id: "entry",
    label: "Entry view (main door)",
    ...level(pos, target),
    fov: small ? FOV + 4 : FOV,
    shiftY: -0.12,
    hide: [`door:${door.id}`],
    note: "Standing in the main door at eye level (1.55 m), the first thing you see walking in.",
  };
}

/**
 * From behind the room's main piece (bed back, sofa back…) looking across it.
 * The camera stands far enough back that the piece's own back is in the
 * bottom of the frame — the classic "over the headboard / over the sofa" shot.
 * Behind a wall, the wall and what hangs on it are clipped away.
 */
function backShot(room: RoomModel, it: Item): Shot {
  const f = dirVec(it.facing);
  const back = opposite(it.facing);
  const name = itemLabel(it.type);
  const wall = wallBehind(room, it, 0.6) ?? null;
  const backEdge: [number, number] = [it.x - (f[0] * it.d) / 2, it.z - (f[1] * it.d) / 2];
  const eye = it.type === "bed" ? 1.6 : EYE;
  const shiftY = -0.28;
  // Put the top of the piece's back about a third of the way up the lower half.
  const drop = Math.max(0.2, eye - Math.min(it.h, eye - 0.2));
  const dist = clamp(drop / lowerEdgeSlope(FOV, shiftY) + 0.35, 0.6, 1.6);
  let pos: [number, number] = [backEdge[0] - f[0] * dist, backEdge[1] - f[1] * dist];
  let hide: string[] = [];
  if (wall || !standable(room, pos[0], pos[1], 0.4)) {
    // Behind the wall: clip it away. Never closer than CLIP_BACK behind it.
    const w = wall ?? wallOfDir(back);
    const gap = Math.abs(dirVec(back)[0]) ? (w === "left" ? backEdge[0] : room.width - backEdge[0]) : w === "top" ? backEdge[1] : room.depth - backEdge[1];
    const behind = Math.max(CLIP_BACK, dist - gap);
    const along = w === "top" || w === "bottom" ? it.x : it.z;
    pos = onWall(room, w, along, -behind);
    hide = hideWall(room, w);
  }
  const target: [number, number] = [pos[0] + f[0] * 6, pos[1] + f[1] * 6];
  return {
    id: "back",
    label: `${cap(name)} back view`,
    ...level(pos, target, eye),
    fov: FOV,
    shiftY,
    hide,
    note: `From behind the ${name}${hide.length ? " (the wall behind it is clipped away)" : ""}, looking across the room.`,
  };
}

/** From the far side of the room, facing the main piece head-on. */
function frontShot(room: RoomModel, it: Item): Shot {
  const f = dirVec(it.facing);
  const name = itemLabel(it.type);
  const w = wallOfDir(it.facing);
  const along = w === "top" || w === "bottom" ? it.x : it.z;
  const pos = onWall(room, w, along, -CLIP_BACK);
  const target: [number, number] = [pos[0] - f[0] * 6, pos[1] - f[1] * 6];
  return {
    id: "front",
    label: `Facing the ${name}`,
    ...level(pos, target),
    fov: FOV,
    shiftY: -0.18,
    hide: hideWall(room, w, true),
    note: `Straight on to the ${name} from the opposite wall (that wall is clipped away).`,
  };
}

function cornerShots(room: RoomModel): Shot[] {
  const shots: Shot[] = [];
  const corners: { id: string; label: string; x: number; z: number }[] = [
    { id: "c-tl", label: "Corner view · top-left", x: 0, z: 0 },
    { id: "c-tr", label: "Corner view · top-right", x: room.width, z: 0 },
    { id: "c-br", label: "Corner view · bottom-right", x: room.width, z: room.depth },
    { id: "c-bl", label: "Corner view · bottom-left", x: 0, z: room.depth },
  ];
  // Candidate spots near a corner, nearest first: a person backs into the
  // corner as far as the furniture lets them.
  const steps: [number, number][] = [];
  for (let a = 0.35; a <= 1.6; a += 0.15) for (let b = 0.35; b <= 1.6; b += 0.15) steps.push([a, b]);
  steps.sort((p, q) => p[0] + p[1] - (q[0] + q[1]) || Math.abs(p[0] - p[1]) - Math.abs(q[0] - q[1]));
  for (const c of corners) {
    const sx = c.x === 0 ? 1 : -1;
    const sz = c.z === 0 ? 1 : -1;
    const pick = steps.map(([a, b]) => [c.x + sx * a, c.z + sz * b] as [number, number]).find(([x, z]) => standable(room, x, z, 0.75));
    if (!pick) continue;
    const target: [number, number] = [room.width / 2 + (room.width / 2) * sx * 0.25, room.depth / 2 + (room.depth / 2) * sz * 0.25];
    shots.push({ id: c.id, label: c.label, ...level(pick, target), fov: FOV, shiftY: -0.1, hide: [], note: "Standing in the corner, looking across the room's diagonal." });
  }
  return shots;
}

function topShot(room: RoomModel): Shot {
  const span = Math.max(room.width, room.depth);
  return {
    id: "top",
    label: "Top view (3D plan)",
    pos: [room.width / 2, span * 2.3 + 1, room.depth / 2 + 0.001],
    target: [room.width / 2, 0, room.depth / 2],
    fov: 30,
    shiftY: 0,
    hide: ["ceiling", "curtains", "exterior"],
    note: "The model seen from above, ceiling removed — check it against your plan.",
  };
}

/** Every preset shot for a room, in the order the UI lists them. */
export function roomShots(room: RoomModel): Shot[] {
  const main = mainItem(room);
  const shots: Shot[] = [entryShot(room, main)];
  if (main) {
    shots.push(backShot(room, main));
    shots.push(frontShot(room, main));
  }
  shots.push(...cornerShots(room), topShot(room));
  return shots;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


/**
 * The pieces a shot's camera actually sees (inside its frame, in front of it,
 * not hidden by the shot). Occlusion is ignored: a piece behind the bed still
 * counts. Used to tell the realistic pass exactly what is in the picture.
 */
export function itemsInView(room: RoomModel, shot: Shot, aspect = 4 / 3): Item[] {
  const [px, py, pz] = shot.pos;
  let fx = shot.target[0] - px;
  let fy = shot.target[1] - py;
  let fz = shot.target[2] - pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,1,0); up' = right × forward
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tv = Math.tan(((shot.fov / 2) * Math.PI) / 180);
  const th = tv * aspect;
  const hidden = new Set(shot.hide);
  const sees = (x: number, y: number, z: number) => {
    const vx = x - px;
    const vy = y - py;
    const vz = z - pz;
    const depth = vx * fx + vy * fy + vz * fz;
    if (depth < 0.15) return false;
    const sx = (vx * rx + vz * rz) / (depth * th);
    const sy = (vx * ux + vy * uy + vz * uz) / (depth * tv);
    return Math.abs(sx) <= 1 && sy >= -1 + shot.shiftY && sy <= 1 + shot.shiftY;
  };
  return room.items.filter((it) => {
    if (hidden.has(`item:${it.id}`)) return false;
    const r = footprint(it);
    const y0 = it.elevation ?? 0;
    for (let a = 0; a <= 4; a++)
      for (let b = 0; b <= 4; b++)
        for (let c = 0; c <= 2; c++) {
          if (sees(r.x0 + ((r.x1 - r.x0) * a) / 4, y0 + (it.h * c) / 2, r.z0 + ((r.z1 - r.z0) * b) / 4)) return true;
        }
    return false;
  });
}
