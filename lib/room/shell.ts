// The room's architecture: floor, four walls of real thickness with every door
// and window cut in (frames, leaves, glass, sills, a daylight view outside),
// skirting, curtains, ceiling with an optional false ceiling (cove light and
// downlights), and the lights that make a raw shot read like a photograph.
//
// Every wall is a group named `wall:<side>` holding everything that hangs on
// it (its door leaves, windows, curtains, the exterior backdrop), so a shot can
// hide one wall — the one the camera stands behind — in one go.

import type { Opening, RoomModel, Wall } from "./types";
import type { BuildCtx } from "./furniture";

type Group = import("three").Group;
type Object3D = import("three").Object3D;

import { FALSE_CEILING_DROP, SKIRT_H, WALL_T } from "./constants";
export { FALSE_CEILING_DROP, SKIRT_H, WALL_T };

/** Length of a wall along its own axis (x for top/bottom, z for left/right). */
export function wallLength(room: RoomModel, wall: Wall): number {
  return wall === "top" || wall === "bottom" ? room.width : room.depth;
}

/**
 * Place a child of a wall group. Each wall group is set up so its local frame
 * is: x along the wall (0 at the wall's start), y up, z pointing INTO the room
 * with the wall's inner face at z = 0.
 */
function wallFrame(c: BuildCtx, wall: Wall): Group {
  const { room } = c;
  const g = c.k.group();
  g.name = `wall:${wall}`;
  switch (wall) {
    case "top":
      g.position.set(0, 0, 0);
      g.rotation.y = 0;
      break;
    case "bottom":
      // Runs right-to-left seen from inside; keep "offset from the left end" by mirroring x.
      g.position.set(room.width, 0, room.depth);
      g.rotation.y = Math.PI;
      break;
    case "left":
      g.position.set(0, 0, room.depth);
      g.rotation.y = Math.PI / 2;
      break;
    case "right":
      g.position.set(room.width, 0, 0);
      g.rotation.y = -Math.PI / 2;
      break;
  }
  return g;
}

/**
 * Convert an opening's `offset` (from the wall's plan start: left end of
 * top/bottom, top end of left/right) to the wall group's local x.
 */
export function localAlong(room: RoomModel, wall: Wall, offset: number): number {
  const L = wallLength(room, wall);
  return wall === "bottom" || wall === "left" ? L - offset : offset;
}

export function buildShell(c: BuildCtx, root: Group): void {
  const { k, m, room } = c;
  const H = room.height;
  const wallMat = room.kind === "bathroom" ? m.floor("tile") : m.wallPaint(room.wallColor);

  // Floor (extended under the walls) and the true ceiling.
  const floor = k.slab(root, room.width + 2 * WALL_T, 0.02, room.depth + 2 * WALL_T, m.floor(room.floor), room.width / 2, -0.02, room.depth / 2, {
    name: "floor",
    cast: false,
  });
  floor.receiveShadow = true;
  const ceilingGroup = k.group(root, "ceiling");
  k.slab(ceilingGroup, room.width + 2 * WALL_T, 0.05, room.depth + 2 * WALL_T, m.wallPaint("#f6f5f2"), room.width / 2, H, room.depth / 2, { cast: false });

  for (const wall of ["top", "bottom", "left", "right"] as Wall[]) {
    const g = wallFrame(c, wall);
    root.add(g);
    buildWall(c, g, wall, wallMat, room.openings.filter((o) => o.wall === wall));
  }

  buildCeiling(c, ceilingGroup);
}

function buildWall(c: BuildCtx, g: Group, wall: Wall, wallMat: import("three").Material, openings: Opening[]): void {
  const { k, m, room } = c;
  const H = room.height;
  const L = wallLength(room, wall);
  // Extend each wall past the corners by the wall thickness so corners close.
  const a0 = -WALL_T;
  const a1 = L + WALL_T;
  const ops = openings
    .map((o) => {
      const cx = localAlong(room, wall, o.offset);
      return { o, s: Math.max(0.02, cx - o.width / 2), e: Math.min(L - 0.02, cx + o.width / 2) };
    })
    .filter((x) => x.e - x.s > 0.2)
    .sort((a, b) => a.s - b.s);

  const piece = (s: number, e: number, y0: number, y1: number, parent: Object3D = g) => {
    if (e - s < 0.005 || y1 - y0 < 0.005) return;
    k.box(parent, e - s, y1 - y0, WALL_T, wallMat, (s + e) / 2, (y0 + y1) / 2, -WALL_T / 2, { grain: 0 });
  };
  const skirt = m.lacquer(room.kind === "bathroom" ? "#d9d4cc" : "#efece6", true);
  const skirting = (s: number, e: number) => {
    if (e - s < 0.02 || room.kind === "bathroom") return;
    k.box(g, e - s, SKIRT_H, 0.015, skirt, (s + e) / 2, SKIRT_H / 2, 0.0075, { cast: false });
  };

  let cursor = a0;
  for (const { o, s, e } of ops) {
    const sOk = Math.max(s, cursor);
    piece(cursor, sOk, 0, H);
    skirting(Math.max(0, cursor), sOk);
    const top = Math.min(H - 0.05, o.sill + o.height);
    piece(sOk, e, top, H);
    if (o.kind === "window") {
      piece(sOk, e, 0, o.sill);
      skirting(sOk, e);
      buildWindow(c, g, o, sOk, e);
    } else if (o.kind === "door") {
      buildDoor(c, g, o, sOk, e, top);
    } else if (o.kind === "sliding") {
      buildSliding(c, g, o, sOk, e, top);
    }
    if (o.kind !== "opening") exteriorView(c, g, sOk, e, o.kind === "window" ? o.sill : 0, top);
    if (room.curtains && (o.kind === "window" || o.kind === "sliding")) buildCurtains(c, g, sOk, e, o.kind === "window" ? o.sill : 0);
    cursor = e;
  }
  piece(cursor, a1, 0, H);
  skirting(Math.max(0, cursor), L);
}

function buildWindow(c: BuildCtx, g: Group, o: Opening, s: number, e: number): void {
  const { k, m } = c;
  const frame = m.lacquer("#3b3d3f", true);
  const w = e - s;
  const cx = (s + e) / 2;
  const y0 = o.sill;
  const y1 = o.sill + o.height;
  const fz = -WALL_T * 0.55;
  const f = 0.05;
  // Outer frame.
  k.box(g, w, f, 0.07, frame, cx, y0 + f / 2, fz);
  k.box(g, w, f, 0.07, frame, cx, y1 - f / 2, fz);
  k.box(g, f, o.height, 0.07, frame, s + f / 2, (y0 + y1) / 2, fz);
  k.box(g, f, o.height, 0.07, frame, e - f / 2, (y0 + y1) / 2, fz);
  // Sashes: a mullion every ~0.75 m.
  const n = Math.max(2, Math.round(w / 0.75));
  for (let i = 1; i < n; i++) k.box(g, 0.04, o.height - f, 0.06, frame, s + (w * i) / n, (y0 + y1) / 2, fz);
  k.box(g, w - f, o.height - f, 0.008, m.glass(), cx, (y0 + y1) / 2, fz, { cast: false, name: "glass" });
  // Inner sill board.
  k.box(g, w + 0.1, 0.03, WALL_T * 0.55 + 0.05, m.stone(c.p.stone === "black-marble" ? "white-marble" : c.p.stone), cx, y0 - 0.015, -WALL_T * 0.25 + 0.025);
}

function buildDoor(c: BuildCtx, g: Group, o: Opening, s: number, e: number, top: number): void {
  const { k, m, p } = c;
  const trim = m.lacquer("#f1eee8", true);
  const w = e - s;
  const cx = (s + e) / 2;
  // Architraves on the room side.
  k.box(g, 0.07, top + 0.07, 0.02, trim, s - 0.035, (top + 0.07) / 2, 0.01);
  k.box(g, 0.07, top + 0.07, 0.02, trim, e + 0.035, (top + 0.07) / 2, 0.01);
  k.box(g, w + 0.14, 0.07, 0.02, trim, cx, top + 0.035, 0.01);
  // Jamb lining.
  k.box(g, 0.025, top, WALL_T, trim, s + 0.0125, top / 2, -WALL_T / 2);
  k.box(g, 0.025, top, WALL_T, trim, e - 0.0125, top / 2, -WALL_T / 2);
  k.box(g, w, 0.025, WALL_T, trim, cx, top - 0.0125, -WALL_T / 2);
  // Closed leaf (laminate in the room's wood) with a lever handle on both faces.
  const leaf = k.group(g, `door:${o.id}`);
  const lw = w - 0.05;
  k.box(leaf, lw, top - 0.03, 0.04, m.wood(p.woodAccent), cx, (top - 0.03) / 2, -WALL_T / 2, { grain: 1 });
  k.box(leaf, lw - 0.1, 0.006, 0.042, m.wood(p.wood), cx, top * 0.55, -WALL_T / 2, { cast: false });
  for (const side of [1, -1]) {
    const hz = -WALL_T / 2 + side * 0.035;
    k.cyl(leaf, 0.025, 0.025, 0.02, m.metal(), e - 0.12, 1.0, hz, 16).rotation.x = Math.PI / 2;
    k.box(leaf, 0.13, 0.018, 0.018, m.metal(), e - 0.17, 1.0, hz + side * 0.02);
  }
}

function buildSliding(c: BuildCtx, g: Group, o: Opening, s: number, e: number, top: number): void {
  const { k, m } = c;
  const frame = m.lacquer("#2f3133", true);
  const w = e - s;
  const panels = Math.max(2, Math.round(w / 1.0));
  const pw = w / panels;
  for (let i = 0; i < panels; i++) {
    const x0 = s + pw * i;
    const z = -WALL_T * 0.5 + (i % 2 ? 0.03 : -0.03);
    k.box(g, pw - 0.06, top - 0.08, 0.008, m.glass(), x0 + pw / 2, top / 2, z, { cast: false, name: "glass" });
    k.box(g, 0.05, top, 0.05, frame, x0 + 0.025, top / 2, z);
    k.box(g, 0.05, top, 0.05, frame, x0 + pw - 0.025, top / 2, z);
    k.box(g, pw, 0.05, 0.05, frame, x0 + pw / 2, 0.025, z);
    k.box(g, pw, 0.05, 0.05, frame, x0 + pw / 2, top - 0.025, z);
  }
  void o;
}

/** A bright daylight backdrop behind every window and door, so openings read as light. */
function exteriorView(c: BuildCtx, g: Group, s: number, e: number, y0: number, y1: number): void {
  const { k, m } = c;
  const mesh = k.box(g, e - s + 3, y1 - y0 + 2.5, 0.01, m.exterior(), (s + e) / 2, (y0 + y1) / 2 + 0.6, -WALL_T - 1.6, {
    cast: false,
    rawUV: true,
    name: "exterior",
  });
  mesh.receiveShadow = false;
}

function buildCurtains(c: BuildCtx, g: Group, s: number, e: number, sill: number): void {
  const { k, m, p } = c;
  const THREE = k.THREE;
  const top = c.ceilingClear - 0.06;
  const ext = 0.3;
  const x0 = s - ext;
  const x1 = e + ext;
  const curt = k.group(g, "curtains");
  k.cyl(curt, 0.012, 0.012, x1 - x0 + 0.1, m.metal(), (x0 + x1) / 2, top + 0.02, 0.12, 12).rotation.z = Math.PI / 2;
  const drop = top - 0.01;
  const wavy = (width: number, folds: number, amp: number) => {
    const geo = new THREE.PlaneGeometry(width, drop, Math.max(24, Math.round(folds * 8)), 1);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(((x + width / 2) / width) * folds * Math.PI * 2) * amp);
    }
    geo.computeVertexNormals();
    return geo;
  };
  // Sheer across the opening.
  const sheerMat = new THREE.MeshStandardMaterial({ color: "#fbfaf6", roughness: 1, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  sheerMat.name = "curtain:sheer";
  const sw = x1 - x0;
  const sheer = new THREE.Mesh(wavy(sw, sw / 0.09, 0.02), m.clay ? m.byRole("fabric") : sheerMat);
  sheer.position.set((x0 + x1) / 2, drop / 2 + 0.01, 0.1);
  curt.add(sheer);
  // Drapes gathered at both sides.
  const drapeMat = m.fabric(p.fabric === "#5f5a55" ? "#4d4945" : p.fabric);
  for (const [cx, w] of [
    [x0 + 0.22, 0.44],
    [x1 - 0.22, 0.44],
  ] as const) {
    // A double-sided copy: the shared fabric material stays single-sided for upholstery.
    const mat = drapeMat.clone();
    mat.side = THREE.DoubleSide;
    const dr = new THREE.Mesh(wavy(w, w / 0.08, 0.035), mat);
    dr.position.set(cx, drop / 2 + 0.01, 0.15);
    dr.castShadow = true;
    curt.add(dr);
  }
  void sill;
}

function buildCeiling(c: BuildCtx, g: Group): void {
  const { k, m, room } = c;
  const H = room.height;
  const THREE = k.THREE;
  const white = m.wallPaint("#f7f6f3");
  if (!room.falseCeiling) {
    k.cyl(g, 0.22, 0.22, 0.04, m.emissive("#fff4e2", 2.2), room.width / 2, H - 0.03, room.depth / 2, 40, { cast: false });
    const l = new THREE.PointLight("#ffe6c4", 10, 9, 2);
    l.position.set(room.width / 2, H - 0.25, room.depth / 2);
    g.add(l);
    return;
  }
  const drop = FALSE_CEILING_DROP;
  const band = Math.min(0.65, Math.min(room.width, room.depth) * 0.18);
  const y = H - drop;
  const W = room.width;
  const D = room.depth;
  // Perimeter band (gypsum), 0.08 thick, with an upturned lip hiding the LED.
  k.slab(g, W, 0.08, band, white, W / 2, y, band / 2, { cast: false });
  k.slab(g, W, 0.08, band, white, W / 2, y, D - band / 2, { cast: false });
  k.slab(g, band, 0.08, D - 2 * band, white, band / 2, y, D / 2, { cast: false });
  k.slab(g, band, 0.08, D - 2 * band, white, W - band / 2, y, D / 2, { cast: false });
  const lipH = 0.12;
  k.slab(g, W - 2 * band, lipH, 0.02, white, W / 2, y + 0.08, band, { cast: false });
  k.slab(g, W - 2 * band, lipH, 0.02, white, W / 2, y + 0.08, D - band, { cast: false });
  k.slab(g, 0.02, lipH, D - 2 * band, white, band, y + 0.08, D / 2, { cast: false });
  k.slab(g, 0.02, lipH, D - 2 * band, white, W - band, y + 0.08, D / 2, { cast: false });
  // Drop wall between the band and the true ceiling, set back to form the cove.
  const set = band - 0.18;
  for (const [cx, cz, w, d] of [
    [W / 2, set, W - 2 * set, 0.02],
    [W / 2, D - set, W - 2 * set, 0.02],
    [set, D / 2, 0.02, D - 2 * set],
    [W - set, D / 2, 0.02, D - 2 * set],
  ] as const) {
    k.slab(g, w, drop - 0.08, d, white, cx, y + 0.08, cz, { cast: false });
  }
  // Cove LED strips and their glow on the central ceiling.
  const led = m.emissive("#ffd8a0", 3);
  k.slab(g, W - 2 * band - 0.04, 0.01, 0.02, led, W / 2, y + 0.085, band - 0.06, { cast: false });
  k.slab(g, W - 2 * band - 0.04, 0.01, 0.02, led, W / 2, y + 0.085, D - band + 0.06, { cast: false });
  k.slab(g, 0.02, 0.01, D - 2 * band - 0.04, led, band - 0.06, y + 0.085, D / 2, { cast: false });
  k.slab(g, 0.02, 0.01, D - 2 * band - 0.04, led, W - band + 0.06, y + 0.085, D / 2, { cast: false });
  const cove = (x: number, z: number, w: number, d: number) => {
    const l = new THREE.RectAreaLight("#ffd29a", 3.2, w, d);
    l.position.set(x, y + 0.1, z);
    l.lookAt(x, H, z);
    g.add(l);
  };
  cove(W / 2, band - 0.07, W - 2 * band, 0.05);
  cove(W / 2, D - band + 0.07, W - 2 * band, 0.05);
  cove(band - 0.07, D / 2, 0.05, D - 2 * band);
  cove(W - band + 0.07, D / 2, 0.05, D - 2 * band);
  // Downlights in the band, ~1.2 m apart; the first few are real spot lights.
  const spots: [number, number][] = [];
  const along = (len: number) => {
    const n = Math.max(2, Math.round(len / 1.3));
    return Array.from({ length: n }, (_, i) => (len * (i + 0.5)) / n);
  };
  for (const x of along(W)) spots.push([x, band / 2], [x, D - band / 2]);
  for (const z of along(D - 2 * band)) spots.push([band / 2, band + z], [W - band / 2, band + z]);
  const disc = m.emissive("#fff6e8", 4);
  spots.forEach(([x, z], i) => {
    k.cyl(g, 0.045, 0.045, 0.01, disc, x, y - 0.002, z, 20, { cast: false });
    if (i % 2 === 0) {
      const s = new THREE.SpotLight("#ffe4bf", 9, 6, 0.75, 0.85, 2);
      s.position.set(x, y - 0.02, z);
      s.target.position.set(x, 0, z + (z < D / 2 ? 0.4 : -0.4));
      g.add(s);
      g.add(s.target);
    }
  });
}

/** Sun through the biggest window plus soft daylight panels at every window. */
export function buildDaylight(c: BuildCtx, root: Group): void {
  const { k, room } = c;
  const THREE = k.THREE;
  const windows = room.openings.filter((o) => o.kind === "window" || o.kind === "sliding");
  for (const o of windows) {
    const { x, z, nx, nz } = openingCentre(room, o);
    const l = new THREE.RectAreaLight("#e8f0ff", 4.5, o.width, o.height);
    const y = (o.kind === "window" ? o.sill : 0) + o.height / 2;
    l.position.set(x + nx * 0.02, y, z + nz * 0.02);
    l.lookAt(x + nx, y, z + nz);
    l.name = `daylight:${o.wall}`;
    root.add(l);
  }
  const main = [...windows].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const sun = new THREE.DirectionalLight("#fff0d9", main ? 2.6 : 0.8);
  if (main) {
    const { x, z, nx, nz } = openingCentre(room, main);
    // Sun outside the window, high and a little to the side, shining in.
    const side = main.wall === "top" || main.wall === "bottom" ? [1, 0] : [0, 1];
    sun.position.set(x - nx * 6 + side[0] * 2.5, 6.5, z - nz * 6 + side[1] * 2.5);
    sun.target.position.set(x + nx * 2, 0, z + nz * 2);
  } else {
    sun.position.set(room.width * 0.2, 8, -5);
    sun.target.position.set(room.width / 2, 0, room.depth / 2);
  }
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const reach = Math.max(room.width, room.depth) + 3;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: 30 });
  sun.name = "sun";
  root.add(sun);
  root.add(sun.target);
  const amb = new THREE.HemisphereLight("#fdf8f0", "#b9a68f", 0.35);
  amb.name = "fill";
  root.add(amb);
}

/** Centre of an opening on the room's inner face, and the inward normal. */
export function openingCentre(room: RoomModel, o: Opening): { x: number; z: number; nx: number; nz: number } {
  switch (o.wall) {
    case "top":
      return { x: o.offset, z: 0, nx: 0, nz: 1 };
    case "bottom":
      return { x: o.offset, z: room.depth, nx: 0, nz: -1 };
    case "left":
      return { x: 0, z: o.offset, nx: 1, nz: 0 };
    default:
      return { x: room.width, z: o.offset, nx: -1, nz: 0 };
  }
}
