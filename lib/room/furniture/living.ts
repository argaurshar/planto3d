// Living / drawing room pieces (local frame: front faces +z, back at −z).

import type { Item } from "../types";
import type { BuildCtx } from "./index";
import { seeded } from "../kit";

type Group = import("three").Group;
type Material = import("three").Material;

/** One sofa module: base, back, arms and cushions over [x0, x1] × [z0, z1]. */
function sofaBlock(
  c: BuildCtx,
  g: Group,
  mat: Material,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  o: { armL: boolean; armR: boolean; back: boolean; seatH?: number; backH?: number; armW?: number; low?: boolean },
): void {
  const { k } = c;
  const seatH = o.seatH ?? 0.44;
  const backH = o.backH ?? 0.82;
  const armW = o.armW ?? 0.17;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const legH = o.low ? 0.04 : 0.11;
  // Legs.
  for (const lx of [x0 + 0.06, x1 - 0.06]) for (const lz of [z0 + 0.06, z1 - 0.06]) k.slab(g, 0.04, legH, 0.04, c.m.metal("black"), lx, 0, lz);
  // Base frame.
  k.rbox(g, w, seatH - 0.12 - legH, d, 0.03, mat, cx, legH + (seatH - 0.12 - legH) / 2, cz);
  const backD = o.back ? 0.2 : 0;
  if (o.back) k.rbox(g, w, backH - legH, backD, 0.04, mat, cx, legH + (backH - legH) / 2, z0 + backD / 2);
  const ax0 = x0 + (o.armL ? armW : 0);
  const ax1 = x1 - (o.armR ? armW : 0);
  if (o.armL) k.rbox(g, armW, 0.62 - legH, d, 0.06, mat, x0 + armW / 2, legH + (0.62 - legH) / 2, cz);
  if (o.armR) k.rbox(g, armW, 0.62 - legH, d, 0.06, mat, x1 - armW / 2, legH + (0.62 - legH) / 2, cz);
  // Seat cushions.
  const sw = ax1 - ax0;
  const n = Math.max(1, Math.round(sw / 0.75));
  const cw = sw / n;
  const sd = d - backD - 0.02;
  for (let i = 0; i < n; i++) {
    k.rbox(g, cw - 0.012, 0.14, sd, 0.05, mat, ax0 + cw * (i + 0.5), seatH - 0.05, z0 + backD + sd / 2 + 0.01);
    if (o.back) {
      const bc = k.rbox(g, cw - 0.02, backH - seatH - 0.02, 0.2, 0.08, mat, ax0 + cw * (i + 0.5), seatH + (backH - seatH) / 2 - 0.02, z0 + backD + 0.08);
      bc.rotation.x = -0.12;
    }
  }
}

export function sofa(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const variant = it.variant;
  const mat =
    variant === "chesterfield" && !it.finish
      ? m.leather()
      : variant === "modular" && !it.finish
        ? m.fabric(p.fabric, "boucle")
        : m.byRole("fabric", it.finish);
  const z0 = -d / 2;
  if (variant === "l-shape") {
    const mainD = Math.min(0.98, d);
    const chaiseW = Math.min(0.95, w * 0.42);
    sofaBlock(c, g, mat, -w / 2, w / 2, z0, z0 + mainD, { armL: true, armR: true, back: true });
    if (d > mainD + 0.3) sofaBlock(c, g, mat, w / 2 - chaiseW, w / 2, z0 + mainD, d / 2, { armL: false, armR: true, back: false });
  } else if (variant === "chesterfield") {
    const h = 0.76;
    sofaBlock(c, g, mat, -w / 2, w / 2, z0, d / 2, { armL: true, armR: true, back: true, backH: h, armW: 0.22 });
    for (const sx of [-1, 1]) {
      const roll = k.cyl(g, 0.13, 0.13, d, mat, sx * (w / 2 - 0.11), 0.62, 0, 24);
      roll.rotation.x = Math.PI / 2;
    }
    const buttons = m.leather("#3a2418");
    for (let i = 0; i < Math.floor((w - 0.5) / 0.16); i++) for (let r = 0; r < 2; r++) {
      k.sphere(g, 0.012, buttons, -w / 2 + 0.3 + i * 0.16 + (r ? 0.08 : 0), 0.58 + r * 0.1, z0 + 0.205);
    }
  } else if (variant === "modular") {
    sofaBlock(c, g, mat, -w / 2, w / 2, z0, d / 2, { armL: true, armR: true, back: true, seatH: 0.4, backH: 0.7, armW: 0.24, low: true });
  } else {
    sofaBlock(c, g, mat, -w / 2, w / 2, z0, z0 + Math.min(d, 1.0), { armL: true, armR: true, back: true });
  }
  // Throw cushions.
  const cush = [m.fabric(p.accent), m.fabric(p.accent2, "velvet"), m.fabric(p.bedding)];
  const spots = w > 1.8 ? [-w / 2 + 0.4, -w / 2 + 0.7, w / 2 - 0.4] : [-w / 2 + 0.35, w / 2 - 0.35];
  spots.forEach((x, i) => {
    const cu = k.rbox(g, 0.44, 0.42, 0.13, 0.07, cush[i % cush.length], x, 0.68, z0 + 0.32);
    cu.rotation.x = -0.28;
    cu.rotation.z = (i % 2 ? -1 : 1) * 0.12;
  });
}

export function armchair(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d } = it;
  const mat = m.byRole("fabric", it.finish ?? (it.variant === "wooden" ? undefined : c.p.accent));
  if (it.variant === "wooden") {
    const wood = m.wood();
    for (const sx of [-1, 1]) {
      k.slab(g, 0.05, 0.62, d - 0.04, wood, sx * (w / 2 - 0.025), 0, 0, { grain: 2 });
      k.slab(g, 0.07, 0.03, d, wood, sx * (w / 2 - 0.035), 0.6, 0, { grain: 2 });
    }
    k.rbox(g, w - 0.12, 0.12, d - 0.12, 0.04, m.fabric(c.p.fabric), 0, 0.4, 0.03);
    const back = k.rbox(g, w - 0.14, 0.45, 0.12, 0.05, m.fabric(c.p.fabric), 0, 0.68, -d / 2 + 0.1);
    back.rotation.x = -0.22;
    k.slab(g, w - 0.1, 0.05, 0.05, wood, 0, 0.3, -d / 2 + 0.05, { grain: 0 });
    return;
  }
  const wing = it.variant === "wing";
  sofaBlock(c, g, mat, -w / 2, w / 2, -d / 2, d / 2, { armL: true, armR: true, back: true, backH: wing ? 1.05 : 0.8, armW: 0.14 });
  if (wing) {
    for (const sx of [-1, 1]) {
      const wg = k.rbox(g, 0.12, 0.42, 0.32, 0.05, mat, sx * (w / 2 - 0.07), 0.82, -d / 2 + 0.22);
      wg.rotation.y = -sx * 0.25;
    }
  }
}

export function coffeeTable(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d, h } = it;
  if (it.variant === "round-marble" || it.variant === "nesting") {
    const pair = it.variant === "nesting";
    const r = Math.min(w, d) / 2 / (pair ? 1.25 : 1);
    const tables = pair
      ? [
          { x: -w / 2 + r, z: -d / 2 + r, r, h },
          { x: w / 2 - r * 0.75, z: d / 2 - r * 0.75, r: r * 0.75, h: h - 0.08 },
        ]
      : [{ x: 0, z: 0, r, h }];
    for (const t of tables) {
      k.cyl(g, t.r, t.r, 0.03, it.variant === "nesting" ? m.byRole("wood", it.finish) : m.byRole("stone", it.finish), t.x, t.h - 0.015, t.z, 40);
      k.cyl(g, t.r * 0.18, t.r * 0.3, t.h - 0.03, m.metal(), t.x, (t.h - 0.03) / 2, t.z, 24);
    }
    k.cyl(g, 0.09, 0.07, 0.1, m.ceramic(p.accent2), tables[0].x + 0.05, h + 0.05, tables[0].z);
    return;
  }
  const wood = m.byRole("wood", it.finish);
  k.slab(g, w, 0.045, d, wood, 0, h - 0.045, 0, { grain: 0 });
  k.slab(g, w - 0.12, 0.03, d - 0.12, wood, 0, 0.1, 0, { grain: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.05, h - 0.045, 0.05, wood, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), { grain: 1 });
  // Books and a bowl.
  k.slab(g, 0.28, 0.035, 0.2, m.fabric(p.accent2), -w * 0.2, h, 0);
  k.slab(g, 0.24, 0.03, 0.18, m.fabric(p.bedding), -w * 0.2, h + 0.035, 0.01);
  k.sphere(g, 0.12, m.ceramic(p.accent), w * 0.2, h + 0.03, 0, [1, 0.35, 1]);
  k.slab(g, 0.5, 0.012, 0.32, m.fabric(p.fabric), 0, 0.13, 0);
}

export function sideTable(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d, h } = it;
  const wood = m.byRole("wood", it.finish);
  if (it.variant === "open-shelf") {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.03, h, 0.03, m.metal("black"), sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03));
    k.slab(g, w, 0.03, d, wood, 0, h - 0.03, 0);
    k.slab(g, w - 0.04, 0.02, d - 0.04, wood, 0, 0.18, 0);
  } else {
    const r = Math.min(w, d) / 2;
    k.cyl(g, r, r, 0.03, wood, 0, h - 0.015, 0);
    k.cyl(g, 0.03, 0.03, h - 0.05, m.metal(), 0, (h - 0.05) / 2 + 0.02, 0);
    k.cyl(g, r * 0.6, r * 0.65, 0.02, m.metal(), 0, 0.01, 0);
  }
  k.cyl(g, 0.05, 0.07, 0.24, m.ceramic(p.accent), 0, h + 0.12, 0);
}

export function ottoman(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d, h } = it;
  const mat = m.byRole("fabric", it.finish ?? c.p.accent2);
  if (it.variant === "square") {
    k.rbox(g, w, h, d, 0.05, mat, 0, h / 2, 0);
    return;
  }
  const r = Math.min(w, d) / 2;
  k.cyl(g, r * 0.98, r * 0.92, h - 0.05, mat, 0, (h - 0.05) / 2, 0, 32);
  k.sphere(g, r, mat, 0, h - 0.05, 0, [1, 0.16, 1]);
}

export function tvUnit(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const wood = m.byRole("wood", it.finish);
  const back = -d / 2;
  const tvW = Math.min(1.45, Math.max(0.9, w * 0.55));
  const tvH = tvW * 0.5625;
  let tvY = 1.15;
  if (it.variant === "panel") {
    const ph = Math.min(2.6, c.ceilingClear - 0.02);
    k.slab(g, w, ph, 0.03, wood, 0, 0, back + 0.015, { grain: 1 });
    const flutes = Math.floor((w * 0.28) / 0.045);
    for (let i = 0; i < flutes; i++) k.rbox(g, 0.037, ph - 0.1, 0.025, 0.012, m.wood(p.woodAccent), w / 2 - 0.02 - 0.045 * (i + 0.5), (ph - 0.1) / 2 + 0.05, back + 0.04, { grain: 1, cast: false });
    k.slab(g, w * 0.7, 0.36, d - 0.03, m.lacquer(p.lacquer, true), -w * 0.15, 0.22, back + 0.03 + (d - 0.03) / 2);
    for (let i = 0; i < 3; i++) k.slab(g, (w * 0.7) / 3 - 0.006, 0.34, 0.01, wood, -w * 0.15 - (w * 0.7) / 3 + i * ((w * 0.7) / 3), 0.23, d / 2 + 0.004);
    for (let i = 0; i < 3; i++) {
      k.slab(g, w * 0.22, 0.025, 0.24, wood, w * 0.32, 1.0 + i * 0.4, back + 0.15);
      k.cyl(g, 0.05, 0.06, 0.18, m.ceramic(i % 2 ? p.accent : p.bedding), w * 0.3, 1.025 + i * 0.4 + 0.09, back + 0.14);
    }
    k.slab(g, w - 0.04, 0.012, 0.012, m.emissive("#ffd49a", 3), 0, ph - 0.03, back + 0.04, { cast: false });
    tvY = 1.25;
  } else if (it.variant === "low") {
    const h = 0.55;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.04, 0.15, 0.04, wood, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06));
    k.slab(g, w, h - 0.15, d, wood, 0, 0.15, 0, { grain: 0 });
    const n = Math.max(2, Math.round(w / 0.55));
    for (let i = 0; i < n; i++) {
      k.slab(g, w / n - 0.008, h - 0.17, 0.008, m.cane(), -w / 2 + (w / n) * (i + 0.5), 0.16, d / 2 + 0.004, { cast: false });
    }
    tvY = h + 0.15 + tvH / 2;
  } else {
    const y0 = 0.28;
    const h = 0.38;
    k.slab(g, w, h, d, wood, 0, y0, 0, { grain: 0 });
    const n = Math.max(2, Math.round(w / 0.6));
    for (let i = 0; i < n; i++) {
      k.slab(g, w / n - 0.008, h - 0.02, 0.012, wood, -w / 2 + (w / n) * (i + 0.5), y0 + 0.01, d / 2 + 0.006, { grain: 0 });
    }
    k.slab(g, w - 0.06, 0.008, 0.01, m.emissive("#ffd49a", 2), 0, y0 - 0.01, d / 2 - 0.05, { cast: false });
    k.slab(g, 0.3, 0.05, 0.2, m.fabric(p.accent2), w * 0.3, y0 + h, 0);
    k.cyl(g, 0.06, 0.05, 0.22, m.ceramic(p.accent), -w * 0.35, y0 + h + 0.11, 0);
    tvY = Math.max(1.1, y0 + h + 0.25 + tvH / 2);
  }
  // Wall-mounted TV.
  k.slab(g, tvW + 0.012, tvH + 0.012, 0.035, m.metal("black"), it.variant === "panel" ? -w * 0.15 : 0, tvY - tvH / 2 - 0.006, back + 0.05);
  k.slab(g, tvW, tvH, 0.005, m.screen(), it.variant === "panel" ? -w * 0.15 : 0, tvY - tvH / 2, back + 0.07, { cast: false });
}

export function rug(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const mat = m.rug(it.variant, it.finish ? [c.p.rug[0], c.p.rug[1], c.p.rug[2]] : c.p.rug);
  if (it.variant === "round") {
    k.cyl(g, Math.min(it.w, it.d) / 2, Math.min(it.w, it.d) / 2, 0.012, mat, 0, 0.006, 0, 48, { rawUV: true, cast: false });
    return;
  }
  k.slab(g, it.w, 0.012, it.d, mat, 0, 0, 0, { rawUV: true, cast: false });
}

export function plant(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const r = seeded(it.id);
  const tall = it.variant !== "bush";
  const potR = Math.min(it.w, it.d) * 0.32;
  const potH = tall ? 0.42 : 0.3;
  k.cyl(g, potR, potR * 0.8, potH, m.ceramic(c.p.accent2 === "#2f6f6b" ? "#c9b49a" : "#d8d1c4"), 0, potH / 2, 0, 28);
  k.cyl(g, potR * 0.92, potR * 0.92, 0.02, m.lacquer("#3b2a1c", true), 0, potH - 0.02, 0);
  const leaf = m.leaf();
  if (tall) {
    const top = Math.max(1.0, it.h);
    k.cyl(g, 0.015, 0.02, top - potH, m.wood("walnut"), 0, potH + (top - potH) / 2, 0, 8);
    for (let i = 0; i < 34; i++) {
      const t = 0.25 + r() * 0.75;
      const y = potH + (top - potH) * t;
      const a = r() * Math.PI * 2;
      const rad = 0.05 + (1 - Math.abs(t - 0.7)) * 0.18;
      const lf = k.sphere(g, 0.1, leaf, Math.cos(a) * rad, y, Math.sin(a) * rad, [0.75, 0.12, 1.1], { cast: true });
      lf.rotation.set(r() - 0.5, a, 0.6 + r() * 0.5);
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      k.sphere(g, 0.14 + r() * 0.06, leaf, Math.cos(a) * 0.1, potH + 0.12 + r() * 0.15, Math.sin(a) * 0.1, [1, 0.8, 1]);
    }
  }
}

export function floorLamp(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const h = Math.max(1.3, it.h);
  if (it.variant === "arc") {
    k.slab(g, 0.3, 0.06, 0.3, m.stone("white-marble"), 0, 0, -0.2);
    const pts: import("three").Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push(new c.k.THREE.Vector3(0, 0.06 + Math.sin(t * Math.PI * 0.55) * (h + 0.3), -0.2 + (1 - Math.cos(t * Math.PI * 0.5)) * 0.9));
    }
    const tube = new c.k.THREE.Mesh(new c.k.THREE.TubeGeometry(new c.k.THREE.CatmullRomCurve3(pts), 40, 0.012, 8), m.metal());
    tube.castShadow = true;
    g.add(tube);
    const end = pts[pts.length - 1];
    k.sphere(g, 0.2, m.metal(), end.x, end.y - 0.12, end.z, [1, 0.6, 1]);
    k.lamp(g, end.x, end.y - 0.3, end.z, 4);
    return;
  }
  k.cyl(g, 0.15, 0.16, 0.025, m.metal(), 0, 0.0125, 0);
  k.cyl(g, 0.012, 0.012, h - 0.3, m.metal(), 0, (h - 0.3) / 2, 0, 8);
  k.cyl(g, 0.2, 0.22, 0.3, m.shade(), 0, h - 0.15, 0, 32, { cast: false });
  k.lamp(g, 0, h - 0.2, 0, 4);
}

export function artwork(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, h, d } = it;
  const y0 = it.elevation ?? 1.5 - h / 2;
  const frame = m.byRole("wood", it.finish ?? "black");
  const pieces = it.variant === "triptych" ? 3 : 1;
  const gap = 0.06;
  const pw = (w - gap * (pieces - 1)) / pieces;
  for (let i = 0; i < pieces; i++) {
    const x = -w / 2 + pw / 2 + i * (pw + gap);
    k.slab(g, pw, h, d, frame, x, y0, -d / 2 + d / 2);
    k.slab(g, pw - 0.06, h - 0.06, 0.005, m.art(hashNum(it.id) + i), x, y0 + 0.03, d / 2 - 0.002, { rawUV: true, cast: false });
  }
}

export function mirror(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, h } = it;
  const y0 = it.elevation ?? 0.9;
  const THREE = c.k.THREE;
  const shape = new THREE.Shape();
  if (it.variant === "round") {
    shape.absarc(0, 0, w / 2, 0, Math.PI * 2, false);
  } else if (it.variant === "arched") {
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2 - w / 2);
    shape.absarc(0, h / 2 - w / 2, w / 2, 0, Math.PI, false);
    shape.lineTo(-w / 2, -h / 2);
  } else {
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2);
  }
  const cy = y0 + (it.variant === "round" ? w / 2 : h / 2);
  const frameGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false, curveSegments: 40 });
  const frameMesh = new THREE.Mesh(frameGeo, m.metal());
  frameMesh.position.set(0, cy, -it.d / 2);
  frameMesh.scale.set(1.04, 1.03, 1);
  frameMesh.castShadow = true;
  g.add(frameMesh);
  const glassMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 40), m.mirror());
  glassMesh.position.set(0, cy, -it.d / 2 + 0.027);
  g.add(glassMesh);
  void k;
}

export function bookshelf(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const h = Math.min(it.h, c.ceilingClear - 0.02);
  const wood = m.byRole("wood", it.finish);
  const r = seeded(it.id);
  for (const sx of [-1, 1]) k.slab(g, 0.025, h, d, wood, sx * (w / 2 - 0.0125), 0, 0, { grain: 1 });
  k.slab(g, w, 0.025, d, wood, 0, h - 0.025, 0);
  k.slab(g, w - 0.05, h, 0.01, wood, 0, 0, -d / 2 + 0.005, { grain: 1 });
  const closed = it.variant === "closed";
  const start = closed ? 0.8 : 0.08;
  if (closed) {
    const n = Math.max(2, Math.round(w / 0.45));
    for (let i = 0; i < n; i++) k.slab(g, (w - 0.05) / n - 0.006, 0.76, 0.018, wood, -w / 2 + 0.025 + ((w - 0.05) / n) * (i + 0.5), 0.02, d / 2 - 0.009);
  }
  const books = [p.accent, p.accent2, p.bedding, p.fabric, "#2f3a4a", "#8a3b2b", "#d9cbb0"];
  for (let y = start; y < h - 0.3; y += 0.36) {
    k.slab(g, w - 0.05, 0.022, d - 0.01, wood, 0, y, 0.005);
    let x = -w / 2 + 0.05;
    while (x < w / 2 - 0.1) {
      if (r() < 0.18) {
        x += 0.12 + r() * 0.1;
        continue;
      }
      const bw = 0.02 + r() * 0.025;
      const bh = 0.2 + r() * 0.09;
      k.slab(g, bw, bh, d * 0.75, m.fabric(books[Math.floor(r() * books.length)]), x + bw / 2, y + 0.022, 0, { cast: false });
      x += bw + 0.002;
    }
  }
}

export function sideboard(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d, h } = it;
  const wood = m.byRole("wood", it.finish);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.035, 0.16, 0.035, m.metal("black"), sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05));
  k.slab(g, w, h - 0.16, d, wood, 0, 0.16, 0, { grain: 0 });
  const n = Math.max(2, Math.round(w / 0.45));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    k.slab(g, w / n - 0.008, h - 0.2, 0.01, it.variant === "cane" ? m.cane() : wood, x, 0.18, d / 2 + 0.005, { cast: false });
    if (it.variant !== "cane") k.slab(g, 0.012, 0.14, 0.015, m.metal(), x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), 0.18 + (h - 0.2) / 2 - 0.07, d / 2 + 0.015);
  }
  k.cyl(g, 0.07, 0.05, 0.3, m.ceramic(p.accent), w * 0.3, h + 0.15, 0);
}

function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h;
}
