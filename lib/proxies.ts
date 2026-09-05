// Scene assembly for the blockout: real proxies instead of boxes.
//
// A bed is a base + mattress + headboard + pillows, a wardrobe has doors and
// handles, a table has legs, walls have thickness with door and window
// openings actually cut into them (frames, sills, a closed leaf, skirting).
// The renderer then has unambiguous geometry to hold on to — a slab could be
// a bed, a bench or a plinth; a mattress with pillows against a headboard is
// a bed — and the preview reads as a room rather than a pile of blocks.
//
// Everything takes the `three` namespace as a parameter because blockout.ts
// imports it dynamically (browser only, code-split out of SSR).

import type { FurnitureCategory, Wall } from "./spatial";

type ThreeNS = typeof import("three");
type Group = import("three").Group;
type Material = import("three").Material;
type Mesh = import("three").Mesh;

export interface ProxyMaterials {
  /** Lit clay material for a colour (memoised by the caller). */
  clay: (color: number) => Material;
  /** Unlit material (window glass reads as a light source). */
  flat: (color: number) => Material;
}

export const PROXY_COLORS = {
  trim: 0xf2efe9, // door/window frames, sills
  skirting: 0xe0dcd5,
  pillow: 0xece5d8,
  handle: 0x3a332c,
  doorLeaf: 0x8a6a4a,
  bedBase: 0x5e4632,
  glass: 0xdaeefc,
  mullion: 0xf2efe9,
  rim: 0xe9f0f3,
} as const;

export const WALL_T = 0.12; // wall thickness (m)
export const DOOR_H = 2.1;
export const WINDOW_SILL = 0.9;
export const WINDOW_HEAD = 2.1;
const SKIRT_H = 0.1;
const SKIRT_T = 0.02;
const FRAME_W = 0.06;

/** A box mesh centred at (x, y, z) with size (w, h, d). */
function box(
  THREE: ThreeNS,
  mat: Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  outline = false,
): Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.outline = outline;
  return m;
}

/**
 * A furniture proxy in a LOCAL frame: origin at floor level under the centre,
 * `w` across (x), `d` deep (z), the piece's back at -z. The caller rotates the
 * group so the back faces its nearest wall.
 */
export function buildFurniture(
  THREE: ThreeNS,
  mats: ProxyMaterials,
  category: FurnitureCategory,
  label: string,
  color: number,
  w: number,
  h: number,
  d: number,
): Group {
  const g = new THREE.Group();
  const l = label.toLowerCase();
  const main = mats.clay(color);

  switch (category) {
    case "bed": {
      const baseH = 0.28;
      const mattH = 0.24;
      g.add(box(THREE, mats.clay(PROXY_COLORS.bedBase), w, baseH, d, 0, baseH / 2, 0, true));
      g.add(box(THREE, main, w - 0.06, mattH, d - 0.06, 0, baseH + mattH / 2, 0, true));
      // Headboard against the wall side.
      g.add(box(THREE, mats.clay(PROXY_COLORS.bedBase), w + 0.04, 1.05, 0.06, 0, 0.525, -d / 2 + 0.03, true));
      const pillowMat = mats.clay(PROXY_COLORS.pillow);
      const pw = Math.min(0.7, w * 0.42);
      const py = baseH + mattH + 0.06;
      const pz = -d / 2 + 0.06 + 0.24;
      if (w >= 1.3) {
        g.add(box(THREE, pillowMat, pw, 0.12, 0.45, -w * 0.23, py, pz));
        g.add(box(THREE, pillowMat, pw, 0.12, 0.45, w * 0.23, py, pz));
      } else {
        g.add(box(THREE, pillowMat, pw, 0.12, 0.45, 0, py, pz));
      }
      // A folded throw across the foot: one more cue that this is a bed.
      g.add(box(THREE, mats.clay(PROXY_COLORS.bedBase), w - 0.1, 0.05, Math.min(0.5, d * 0.25), 0, baseH + mattH + 0.025, d / 2 - 0.05 - Math.min(0.5, d * 0.25) / 2));
      return g;
    }
    case "storage": {
      if (/\b(bookshelf|bookcase|shelf|shelves|shelving)\b/.test(l)) {
        // Open shelving: a carcass with shelf boards, not doors.
        g.add(box(THREE, main, w, h, d, 0, h / 2, 0, true));
        const shelfMat = mats.clay(lighten(color, 28));
        const n = Math.max(2, Math.round(h / 0.38));
        for (let i = 1; i < n; i++) {
          g.add(box(THREE, shelfMat, w - 0.06, 0.025, d, 0, (h * i) / n, 0.01));
        }
        return g;
      }
      const body = box(THREE, main, w, h, d, 0, h / 2, 0, true);
      g.add(body);
      // Door panels on the front face, slightly proud, with handles by the gap.
      const front = d / 2 + 0.01;
      const panelH = h - 0.12;
      const panelMat = mats.clay(lighten(color));
      const handleMat = mats.clay(PROXY_COLORS.handle);
      if (w >= 0.7) {
        const pw = w / 2 - 0.03;
        g.add(box(THREE, panelMat, pw, panelH, 0.02, -w / 4, 0.06 + panelH / 2, front));
        g.add(box(THREE, panelMat, pw, panelH, 0.02, w / 4, 0.06 + panelH / 2, front));
        g.add(box(THREE, handleMat, 0.02, 0.14, 0.02, -0.05, Math.min(1.0, h * 0.5), front + 0.02));
        g.add(box(THREE, handleMat, 0.02, 0.14, 0.02, 0.05, Math.min(1.0, h * 0.5), front + 0.02));
      } else {
        g.add(box(THREE, panelMat, w - 0.06, panelH, 0.02, 0, 0.06 + panelH / 2, front));
        g.add(box(THREE, handleMat, 0.02, 0.14, 0.02, w / 2 - 0.08, Math.min(1.0, h * 0.5), front + 0.02));
      }
      return g;
    }
    case "table": {
      if (/\b(nightstand|bedside|counter|kitchen|vanity|cabinet)\b/.test(l)) {
        // Cabinet: a body with a drawer front and a handle.
        g.add(box(THREE, main, w, h, d, 0, h / 2, 0, true));
        g.add(box(THREE, mats.clay(lighten(color)), w - 0.06, h * 0.35, 0.02, 0, h * 0.7, d / 2 + 0.01));
        g.add(box(THREE, mats.clay(PROXY_COLORS.handle), 0.12, 0.02, 0.02, 0, h * 0.7, d / 2 + 0.03));
        return g;
      }
      // Table / desk: a top on four legs.
      const topT = 0.04;
      g.add(box(THREE, main, w, topT, d, 0, h - topT / 2, 0, true));
      const legMat = mats.clay(lighten(color, -20));
      const leg = 0.06;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          g.add(box(THREE, legMat, leg, h - topT, leg, sx * (w / 2 - leg), (h - topT) / 2, sz * (d / 2 - leg)));
        }
      }
      return g;
    }
    case "seating": {
      if (/\b(stool|bench|ottoman)\b/.test(l)) {
        g.add(box(THREE, main, w, h, d, 0, h / 2, 0, true));
        return g;
      }
      if (/\b(chair)\b/.test(l) && !/\barm/.test(l)) {
        // Dining/desk chair: seat slab, four legs, a back.
        const seatH = 0.45;
        g.add(box(THREE, main, w, 0.06, d, 0, seatH - 0.03, 0, true));
        const legMat = mats.clay(lighten(color, -20));
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            g.add(box(THREE, legMat, 0.04, seatH - 0.06, 0.04, sx * (w / 2 - 0.04), (seatH - 0.06) / 2, sz * (d / 2 - 0.04)));
          }
        }
        g.add(box(THREE, main, w, 0.45, 0.05, 0, seatH + 0.225, -d / 2 + 0.025, true));
        return g;
      }
      // Sofa / armchair: base, backrest against the wall side, two arms.
      const baseH = 0.42;
      g.add(box(THREE, main, w, baseH, d, 0, baseH / 2, 0, true));
      g.add(box(THREE, main, w, 0.45, 0.22, 0, baseH + 0.225, -d / 2 + 0.11, true));
      const armW = Math.min(0.2, w * 0.15);
      g.add(box(THREE, main, armW, 0.2, d, -w / 2 + armW / 2, baseH + 0.1, 0));
      g.add(box(THREE, main, armW, 0.2, d, w / 2 - armW / 2, baseH + 0.1, 0));
      // Seat cushions.
      const cushMat = mats.clay(lighten(color));
      const n = w > 1.6 ? 3 : w > 1.0 ? 2 : 1;
      const cw = (w - 2 * armW) / n;
      for (let i = 0; i < n; i++) {
        g.add(box(THREE, cushMat, cw - 0.04, 0.1, d - 0.26, -w / 2 + armW + cw * (i + 0.5), baseH + 0.05, 0.02));
      }
      return g;
    }
    case "bath": {
      if (/\b(toilet|wc)\b/.test(l)) {
        g.add(box(THREE, main, Math.min(w, 0.45), 0.42, Math.min(d, 0.55), 0, 0.21, 0.05, true));
        g.add(box(THREE, main, Math.min(w, 0.45), 0.4, 0.18, 0, 0.62, -d / 2 + 0.09, true));
        return g;
      }
      if (/\b(sink|basin|washbasin)\b/.test(l)) {
        g.add(box(THREE, main, 0.22, 0.75, 0.22, 0, 0.375, 0));
        g.add(box(THREE, main, w, 0.15, d, 0, 0.825, 0, true));
        return g;
      }
      if (/\b(shower)\b/.test(l)) {
        g.add(box(THREE, main, w, 0.08, d, 0, 0.04, 0, true));
        g.add(box(THREE, mats.flat(PROXY_COLORS.glass), w, 1.95, 0.02, 0, 0.08 + 0.975, d / 2 - 0.01, true));
        return g;
      }
      // Bathtub: a tub with a lighter rim.
      g.add(box(THREE, main, w, 0.55, d, 0, 0.275, 0, true));
      g.add(box(THREE, mats.clay(PROXY_COLORS.rim), w - 0.16, 0.02, d - 0.16, 0, 0.56, 0));
      return g;
    }
    case "rug":
      g.add(box(THREE, main, w, 0.02, d, 0, 0.01, 0, true));
      return g;
    default:
      g.add(box(THREE, main, w, h, d, 0, h / 2, 0, true));
      return g;
  }
}

/** Nudge a packed RGB colour lighter (positive) or darker (negative). */
function lighten(color: number, amount = 18): number {
  const c = (v: number) => Math.max(0, Math.min(255, v + amount));
  const r = c((color >> 16) & 255);
  const g = c((color >> 8) & 255);
  const b = c(color & 255);
  return (r << 16) | (g << 8) | b;
}

/** Rotation (about Y) that turns a proxy's back (-z) toward `wall`. */
export function facingRotation(wall: Wall): number {
  switch (wall) {
    case "far":
      return 0;
    case "near":
      return Math.PI;
    case "left":
      return Math.PI / 2;
    default:
      return -Math.PI / 2;
  }
}

export interface WallOpening {
  kind: "door" | "window";
  /** Start/end along the wall, metres, in the wall's own axis (x for far/near, z for left/right). */
  start: number;
  end: number;
}

export interface WallSpec {
  wall: Wall;
  /** Extent along the wall (shell extent, so flanking walls stretch with the camera offset). */
  a0: number;
  a1: number;
  /** Where the wall plane sits on the perpendicular axis (z for far/near, x for left/right). */
  at: number;
  /** +1 if the wall's outside is toward +axis, -1 toward -axis. */
  outward: 1 | -1;
  openings: WallOpening[];
  wallH: number;
}

/**
 * A wall of real thickness with its openings cut in: full-height pieces
 * between openings, a lintel over each, a sill piece under each window,
 * frames, a closed door leaf, glass with a cross mullion, a window board and
 * skirting along the base (interrupted by doors).
 */
export function buildWall(THREE: ThreeNS, mats: ProxyMaterials, spec: WallSpec, wallColor: number): Group {
  const g = new THREE.Group();
  const wallMat = mats.clay(wallColor);
  const trimMat = mats.clay(PROXY_COLORS.trim);
  const skirtMat = mats.clay(PROXY_COLORS.skirting);
  const along = spec.wall === "far" || spec.wall === "near";
  const T = WALL_T;
  const H = spec.wallH;
  // Centre of the wall's thickness (just outside the room) and of the inner
  // face (skirting, frames) on the perpendicular axis.
  const mid = spec.at + (spec.outward * T) / 2;
  const inner = spec.at - spec.outward * 0.001;

  const place = (m: Mesh, a: number, y: number, p: number) => {
    if (along) m.position.set(a, y, p);
    else m.position.set(p, y, a);
    return m;
  };
  const piece = (mat: Material, s: number, e: number, y0: number, y1: number, p = mid, t = T, outline = false) => {
    if (e - s <= 0.001 || y1 - y0 <= 0.001) return;
    const len = e - s;
    const m = along
      ? box(THREE, mat, len, y1 - y0, t, 0, 0, 0, outline)
      : box(THREE, mat, t, y1 - y0, len, 0, 0, 0, outline);
    g.add(place(m, (s + e) / 2, (y0 + y1) / 2, p));
  };
  const skirt = (s: number, e: number) =>
    piece(skirtMat, s, e, 0, SKIRT_H, spec.at - spec.outward * (SKIRT_T / 2), SKIRT_T);

  // Clamp, sort and de-overlap the openings.
  const ops = spec.openings
    .map((o) => ({ ...o, start: Math.max(spec.a0 + 0.05, o.start), end: Math.min(spec.a1 - 0.05, o.end) }))
    .filter((o) => o.end - o.start > 0.2)
    .sort((a, b) => a.start - b.start);
  let cursor = spec.a0;
  for (const o of ops) {
    if (o.start < cursor) o.start = cursor;
    if (o.end - o.start < 0.2) continue;
    piece(wallMat, cursor, o.start, 0, H);
    skirt(cursor, o.start);
    if (o.kind === "door") {
      piece(wallMat, o.start, o.end, DOOR_H, H); // lintel
      // Frame: jambs + head, slightly proud of the wall on the room side.
      const fp = spec.at - spec.outward * 0.01;
      piece(trimMat, o.start - FRAME_W, o.start, 0, DOOR_H + FRAME_W, fp, T + 0.02);
      piece(trimMat, o.end, o.end + FRAME_W, 0, DOOR_H + FRAME_W, fp, T + 0.02);
      piece(trimMat, o.start - FRAME_W, o.end + FRAME_W, DOOR_H, DOOR_H + FRAME_W, fp, T + 0.02);
      // Closed leaf set into the opening, with a handle.
      piece(mats.clay(PROXY_COLORS.doorLeaf), o.start + 0.02, o.end - 0.02, 0.01, DOOR_H - 0.01, mid, 0.045, true);
      const handle = along
        ? box(THREE, mats.clay(PROXY_COLORS.handle), 0.12, 0.02, 0.02, 0, 0, 0)
        : box(THREE, mats.clay(PROXY_COLORS.handle), 0.02, 0.02, 0.12, 0, 0, 0);
      g.add(place(handle, o.end - 0.12, 1.0, spec.at - spec.outward * 0.04));
    } else {
      piece(wallMat, o.start, o.end, WINDOW_HEAD, H); // lintel
      piece(wallMat, o.start, o.end, 0, WINDOW_SILL); // under the sill
      skirt(o.start, o.end);
      // Glass, unlit so it reads as daylight, with a cross mullion.
      piece(mats.flat(PROXY_COLORS.glass), o.start, o.end, WINDOW_SILL, WINDOW_HEAD, mid, 0.02, true);
      const midA = (o.start + o.end) / 2;
      const midY = (WINDOW_SILL + WINDOW_HEAD) / 2;
      piece(mats.clay(PROXY_COLORS.mullion), midA - 0.02, midA + 0.02, WINDOW_SILL, WINDOW_HEAD, mid, 0.05);
      piece(mats.clay(PROXY_COLORS.mullion), o.start, o.end, midY - 0.02, midY + 0.02, mid, 0.05);
      // Frame + a board that projects into the room.
      const fp = spec.at - spec.outward * 0.01;
      piece(trimMat, o.start - FRAME_W, o.start, WINDOW_SILL - FRAME_W, WINDOW_HEAD + FRAME_W, fp, T + 0.02);
      piece(trimMat, o.end, o.end + FRAME_W, WINDOW_SILL - FRAME_W, WINDOW_HEAD + FRAME_W, fp, T + 0.02);
      piece(trimMat, o.start - FRAME_W, o.end + FRAME_W, WINDOW_HEAD, WINDOW_HEAD + FRAME_W, fp, T + 0.02);
      piece(trimMat, o.start - FRAME_W - 0.02, o.end + FRAME_W + 0.02, WINDOW_SILL - 0.04, WINDOW_SILL, spec.at - spec.outward * 0.05, 0.12);
    }
    cursor = o.end;
  }
  piece(wallMat, cursor, spec.a1, 0, H);
  skirt(cursor, spec.a1);
  void inner;
  return g;
}
