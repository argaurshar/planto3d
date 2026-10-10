// Dining, study, kitchen and bathroom pieces (local frame: front faces +z).

import type { Item } from "../types";
import type { BuildCtx } from "./index";

type Group = import("three").Group;
type Material = import("three").Material;

/** A dining chair at (x, z) whose front looks along `rotY` (0 = +z). */
function diningChair(c: BuildCtx, g: Group, x: number, z: number, rotY: number, seatMat: Material): void {
  const { k, m } = c;
  const ch = k.group(g);
  ch.position.set(x, 0, z);
  ch.rotation.y = rotY;
  const wood = m.wood(c.p.woodAccent);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = k.slab(ch, 0.032, 0.45, 0.032, wood, sx * 0.2, 0, sz * 0.19, { grain: 1 });
    leg.rotation.x = sz * 0.04;
  }
  k.rbox(ch, 0.46, 0.06, 0.44, 0.02, seatMat, 0, 0.47, 0.01);
  for (const sx of [-1, 1]) k.slab(ch, 0.03, 0.42, 0.03, wood, sx * 0.2, 0.45, -0.205, { grain: 1 });
  const back = k.rbox(ch, 0.44, 0.22, 0.04, 0.015, seatMat, 0, 0.74, -0.215);
  back.rotation.x = -0.08;
}

export function diningSet(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const h = 0.75;
  const seat = m.fabric(p.fabric);
  const top = it.variant === "marble" ? m.byRole("stone", it.finish) : m.byRole("wood", it.finish);
  if (it.variant === "round") {
    const r = Math.min(w, d) / 2;
    k.cyl(g, r, r, 0.04, top, 0, h - 0.02, 0, 48);
    k.cyl(g, 0.07, 0.09, h - 0.04, m.wood(), 0, (h - 0.04) / 2, 0, 24);
    k.cyl(g, r * 0.45, r * 0.5, 0.04, m.wood(), 0, 0.02, 0, 32);
    const n = r > 0.55 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 4;
      const rr = r + 0.22;
      diningChair(c, g, Math.cos(a) * rr, Math.sin(a) * rr, Math.atan2(-Math.cos(a), -Math.sin(a)), seat);
    }
  } else {
    k.slab(g, w, 0.045, d, top, 0, h - 0.045, 0, { grain: 0 });
    const legMat = it.variant === "marble" ? m.metal() : m.wood();
    if (it.variant === "marble") {
      for (const sx of [-1, 1]) k.slab(g, 0.08, h - 0.045, d * 0.6, legMat, sx * (w / 2 - 0.35), 0, 0);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.06, h - 0.045, 0.06, legMat, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), { grain: 1 });
      k.slab(g, w - 0.2, 0.08, 0.025, legMat, 0, h - 0.125, d / 2 - 0.09, { grain: 0 });
      k.slab(g, w - 0.2, 0.08, 0.025, legMat, 0, h - 0.125, -d / 2 + 0.09, { grain: 0 });
    }
    const perSide = Math.max(1, Math.floor((w - 0.2) / 0.6));
    for (let i = 0; i < perSide; i++) {
      const x = -((perSide - 1) * 0.6) / 2 + i * 0.6;
      diningChair(c, g, x, d / 2 + 0.18, Math.PI, seat);
      diningChair(c, g, x, -d / 2 - 0.18, 0, seat);
    }
    if (w >= 1.8) {
      diningChair(c, g, w / 2 + 0.2, 0, -Math.PI / 2, seat);
      diningChair(c, g, -w / 2 - 0.2, 0, Math.PI / 2, seat);
    }
    // Runner and a centrepiece.
    k.slab(g, Math.min(w - 0.3, 1.4), 0.004, 0.35, m.fabric(p.accent2), 0, h, 0, { cast: false });
    k.cyl(g, 0.08, 0.06, 0.24, m.ceramic(p.accent), 0, h + 0.12, 0);
  }
  // Pendant over the table.
  const ceil = c.ceilingClear;
  const dropY = Math.max(h + 0.75, ceil - 1.0);
  k.cyl(g, 0.004, 0.004, ceil - dropY, m.metal("black"), 0, dropY + (ceil - dropY) / 2, 0, 6, { cast: false });
  k.cyl(g, 0.06, 0.26, 0.2, m.metal(), 0, dropY - 0.1, 0, 32);
  k.cyl(g, 0.2, 0.2, 0.005, m.emissive("#ffe2b0", 2), 0, dropY - 0.2, 0, 32, { cast: false });
  k.lamp(g, 0, dropY - 0.28, 0, 6);
}

function officeChair(c: BuildCtx, g: Group, x: number, z: number, rotY: number): void {
  const { k, m } = c;
  const ch = k.group(g);
  ch.position.set(x, 0, z);
  ch.rotation.y = rotY;
  const black = m.metal("black");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = k.slab(ch, 0.03, 0.03, 0.3, black, Math.sin(a) * 0.14, 0.05, Math.cos(a) * 0.14);
    arm.rotation.y = a;
    k.sphere(ch, 0.025, black, Math.sin(a) * 0.28, 0.025, Math.cos(a) * 0.28);
  }
  k.cyl(ch, 0.022, 0.022, 0.38, m.metal("steel"), 0, 0.25, 0, 12);
  k.rbox(ch, 0.48, 0.08, 0.46, 0.03, m.fabric("#3e3d3b"), 0, 0.47, 0);
  const back = k.rbox(ch, 0.44, 0.52, 0.06, 0.03, m.fabric("#3e3d3b"), 0, 0.82, -0.22);
  back.rotation.x = -0.12;
}

export function desk(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const h = 0.75;
  const wood = m.byRole("wood", it.finish);
  k.slab(g, w, 0.035, d, wood, 0, h - 0.035, 0, { grain: 0 });
  for (const sx of [-1, 1]) k.slab(g, 0.035, h - 0.035, d - 0.04, wood, sx * (w / 2 - 0.0175), 0, 0, { grain: 1 });
  k.slab(g, 0.42, 0.14, d - 0.06, wood, w / 2 - 0.25, h - 0.175, 0);
  k.slab(g, 0.4, 0.12, 0.01, m.wood(p.woodAccent), w / 2 - 0.25, h - 0.165, d / 2 - 0.025);
  // Laptop + lamp + chair.
  k.slab(g, 0.34, 0.012, 0.24, m.metal("steel"), -0.05, h, 0.05);
  const screen = k.slab(g, 0.34, 0.22, 0.008, m.metal("steel"), -0.05, h + 0.005, -0.07);
  screen.rotation.x = -0.25;
  k.cyl(g, 0.07, 0.07, 0.02, m.metal("black"), -w / 2 + 0.15, h + 0.01, -d / 4);
  k.cyl(g, 0.008, 0.008, 0.4, m.metal("black"), -w / 2 + 0.15, h + 0.2, -d / 4, 8);
  k.cyl(g, 0.05, 0.09, 0.12, m.metal("black"), -w / 2 + 0.15, h + 0.43, -d / 4 + 0.05);
  k.lamp(g, -w / 2 + 0.15, h + 0.35, -d / 4 + 0.06, 2.5);
  officeChair(c, g, -0.05, d / 2 + 0.35, Math.PI);
  if (it.variant === "shelves") {
    for (let i = 0; i < 3; i++) {
      const y = h + 0.45 + i * 0.38;
      k.slab(g, w * 0.8, 0.025, 0.25, wood, 0, y, -d / 2 + 0.125, { grain: 0 });
      for (let b = 0; b < 8; b++) k.slab(g, 0.03, 0.2 + (b % 3) * 0.03, 0.18, m.fabric([p.accent, p.accent2, p.bedding, "#2f3a4a"][b % 4]), -w * 0.35 + b * 0.035 + i * 0.1, y + 0.025, -d / 2 + 0.12, { cast: false });
    }
  }
}

export function chair(c: BuildCtx, it: Item, g: Group): void {
  if (it.variant === "office") officeChair(c, g, 0, 0, 0);
  else diningChair(c, g, 0, 0, 0, c.m.byRole("fabric", it.finish ?? c.p.fabric));
}

export function kitchenCounter(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const back = -d / 2;
  const shutter = m.byRole("lacquer", it.finish ?? (c.style === "luxury" ? "charcoal" : undefined));
  const carcass = m.lacquer("#e9e5de", true);
  const top = m.stone(c.style === "luxury" ? "black-marble" : "white-marble");
  const baseH = 0.86;
  const classic = it.variant === "classic";
  k.slab(g, w - 0.02, 0.1, d - 0.08, m.lacquer("#2c2b29", true), 0, 0, -0.04);
  k.slab(g, w, baseH - 0.14, d - 0.04, carcass, 0, 0.1, -0.02);
  const n = Math.max(2, Math.round(w / 0.6));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + sw * (i + 0.5);
    const drawers = i % 3 === 1;
    const rows = drawers ? 3 : 1;
    const rh = (baseH - 0.15) / rows;
    for (let r = 0; r < rows; r++) {
      k.slab(g, sw - 0.004, rh - 0.004, 0.018, shutter, x, 0.102 + r * rh, d / 2 - 0.02);
      if (classic) k.slab(g, 0.12, 0.012, 0.02, m.metal(), x, 0.1 + r * rh + rh - 0.06, d / 2 + 0.002);
    }
  }
  if (!classic) k.slab(g, w, 0.02, 0.02, m.metal("steel"), 0, baseH - 0.06, d / 2 - 0.02);
  k.slab(g, w + 0.02, 0.04, d + 0.02, top, 0, baseH - 0.04, 0);
  // Backsplash.
  k.slab(g, w, 0.6, 0.012, m.floor("tile"), 0, baseH, back + 0.006, { cast: false });
  // Sink and faucet.
  const sx = -w / 4;
  k.slab(g, 0.55, 0.01, 0.42, m.metal("steel"), sx, baseH - 0.002, 0.02, { cast: false });
  k.slab(g, 0.5, 0.012, 0.38, m.lacquer("#2a2b2c", true), sx, baseH - 0.001, 0.02, { cast: false });
  k.cyl(g, 0.02, 0.025, 0.32, m.metal("steel"), sx, baseH + 0.16, back + 0.08, 12);
  const spout = k.cyl(g, 0.012, 0.012, 0.22, m.metal("steel"), sx, baseH + 0.31, back + 0.18, 12);
  spout.rotation.x = Math.PI / 2;
  // Hob + chimney.
  const hx = w / 4;
  k.slab(g, 0.6, 0.008, 0.5, m.screen(), hx, baseH, 0.01);
  for (const [ox, oz] of [
    [-0.15, -0.1],
    [0.15, -0.1],
    [-0.15, 0.12],
    [0.15, 0.12],
  ])
    k.torus(g, 0.07, 0.006, m.metal("steel"), hx + ox, baseH + 0.01, oz).rotation.x = Math.PI / 2;
  const upperY = baseH + 0.6;
  const upperH = Math.min(0.75, c.ceilingClear - upperY - 0.05);
  k.slab(g, 0.6, 0.12, 0.45, m.metal("steel"), hx, upperY, back + 0.225);
  k.slab(g, 0.25, Math.max(0.1, c.ceilingClear - upperY - 0.12), 0.25, m.metal("steel"), hx, upperY + 0.12, back + 0.125);
  // Upper cabinets either side of the chimney.
  const uw = (w - 0.7) / 2;
  if (uw > 0.3 && upperH > 0.3) {
    for (const s of [-1, 1]) {
      const ux = s < 0 ? -w / 2 + uw / 2 : w / 2 - uw / 2;
      if (s > 0 && hx + 0.35 > w / 2 - uw) {
        /* chimney sits in the right run; keep it clear */
      }
      k.slab(g, uw, upperH, 0.35, carcass, ux, upperY, back + 0.175);
      const un = Math.max(1, Math.round(uw / 0.5));
      for (let i = 0; i < un; i++) k.slab(g, uw / un - 0.004, upperH - 0.004, 0.018, shutter, ux - uw / 2 + (uw / un) * (i + 0.5), upperY + 0.002, back + 0.36);
      k.slab(g, uw - 0.04, 0.008, 0.015, m.emissive("#fff0d8", 2), ux, upperY - 0.01, back + 0.3, { cast: false });
    }
  }
  k.cyl(g, 0.08, 0.06, 0.25, m.ceramic(p.accent), w / 2 - 0.2, baseH + 0.125, -0.1);
}

export function fridge(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d, h } = it;
  const steel = m.byRole("metal", it.finish ?? "steel");
  k.rbox(g, w, h, d - 0.04, 0.02, steel, 0, h / 2, -0.02);
  k.slab(g, w - 0.01, h * 0.65 - 0.01, 0.04, steel, 0, 0, d / 2 - 0.04);
  k.slab(g, w - 0.01, h * 0.35 - 0.01, 0.04, steel, 0, h * 0.65, d / 2 - 0.04);
  k.slab(g, 0.02, 0.5, 0.03, m.metal("black"), w / 2 - 0.06, h * 0.3, d / 2 + 0.01);
  k.slab(g, 0.02, 0.3, 0.03, m.metal("black"), w / 2 - 0.06, h * 0.7, d / 2 + 0.01);
}

export function toilet(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { d } = it;
  const white = m.ceramic();
  const back = -d / 2;
  if (it.variant === "floor") {
    k.rbox(g, 0.38, 0.38, 0.2, 0.05, white, 0, 0.6, back + 0.1);
    k.rbox(g, 0.3, 0.36, 0.42, 0.1, white, 0, 0.18, back + 0.32);
  } else {
    k.slab(g, 0.6, 1.1, 0.14, m.floor("tile"), 0, 0, back + 0.07);
    k.slab(g, 0.22, 0.14, 0.01, m.metal("steel"), 0, 0.95, back + 0.145);
    k.rbox(g, 0.36, 0.3, 0.52, 0.12, white, 0, 0.3, back + 0.14 + 0.26);
  }
  k.rbox(g, 0.37, 0.03, 0.46, 0.1, white, 0, it.variant === "floor" ? 0.38 : 0.46, back + 0.14 + 0.24);
}

export function vanity(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d } = it;
  const back = -d / 2;
  const y0 = 0.45;
  if (it.variant === "counter-basin") {
    k.slab(g, w, 0.04, d, m.byRole("stone", it.finish), 0, 0.82, 0);
    k.slab(g, w, 0.3, d - 0.02, m.wood(), 0, 0.52, -0.01);
    k.cyl(g, 0.2, 0.17, 0.13, m.ceramic(), 0, 0.925, 0.02, 40);
  } else {
    k.slab(g, w, 0.42, d, m.byRole("wood", it.finish), 0, y0, 0, { grain: 0 });
    k.rbox(g, w + 0.01, 0.12, d + 0.01, 0.02, m.ceramic(), 0, y0 + 0.42 + 0.06, 0);
    k.slab(g, w * 0.55, 0.01, d * 0.6, m.ceramic("#e9ece9"), 0, y0 + 0.535, 0.02, { cast: false });
  }
  const top = it.variant === "counter-basin" ? 0.86 : y0 + 0.54;
  k.cyl(g, 0.018, 0.022, 0.2, m.metal("steel"), 0, top + 0.1, back + 0.05, 12);
  const sp = k.cyl(g, 0.01, 0.01, 0.12, m.metal("steel"), 0, top + 0.19, back + 0.1, 12);
  sp.rotation.x = Math.PI / 2;
  // Backlit mirror.
  const mw = Math.min(w, 0.9);
  k.slab(g, mw + 0.03, 0.83, 0.02, m.emissive("#fff3df", 1.6), 0, top + 0.3, back + 0.01, { cast: false });
  k.slab(g, mw, 0.8, 0.01, m.mirror(), 0, top + 0.315, back + 0.025, { cast: false });
}

export function shower(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d } = it;
  const back = -d / 2;
  k.slab(g, w, 0.02, d, m.stone("grey-marble"), 0, 0, 0, { cast: false });
  k.slab(g, 0.01, 2.0, d * 0.9, m.glass("#dfe9ea", 0.22), w / 2 - 0.01, 0.02, 0.0, { cast: false });
  k.slab(g, w * 0.95, 2.0, 0.01, m.glass("#dfe9ea", 0.22), 0, 0.02, d / 2 - 0.01, { cast: false });
  k.slab(g, 0.025, 2.0, 0.025, m.metal("black"), w / 2 - 0.01, 0.02, d / 2 - 0.01);
  k.cyl(g, 0.012, 0.012, 0.35, m.metal("steel"), 0, 2.05, back + 0.17, 8).rotation.x = Math.PI / 2;
  k.cyl(g, 0.12, 0.12, 0.015, m.metal("steel"), 0, 2.03, back + 0.33, 32);
  k.cyl(g, 0.03, 0.03, 0.12, m.metal("steel"), 0, 1.05, back + 0.04, 12).rotation.x = Math.PI / 2;
}

export function bathtub(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d, h } = it;
  k.slab(g, w, h, d, m.floor("tile"), 0, 0, 0);
  k.rbox(g, w - 0.12, 0.05, d - 0.12, 0.06, m.ceramic(), 0, h - 0.02, 0);
  k.rbox(g, w - 0.18, 0.02, d - 0.18, 0.08, m.ceramic("#e8eef0"), 0, h - 0.06, 0, { cast: false });
  k.cyl(g, 0.02, 0.02, 0.2, m.metal("steel"), w / 2 - 0.15, h + 0.1, -d / 2 + 0.06, 12);
}

export function genericBox(c: BuildCtx, it: Item, g: Group): void {
  c.k.rbox(g, it.w, it.h, it.d, 0.01, c.m.byRole("wood", it.finish), 0, it.h / 2, 0);
}
