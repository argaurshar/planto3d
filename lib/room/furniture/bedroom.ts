// Bedroom pieces. Every builder works in the item's LOCAL frame: origin on the
// floor at the centre of the footprint, width along x, depth along z, the
// FRONT (foot of the bed, doors of a wardrobe) facing +z, the back at −z.

import type { Item } from "../types";
import type { BuildCtx } from "./index";

type Group = import("three").Group;

export function bed(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const back = -d / 2;
  const main = m.byRole(it.variant === "wooden" || it.variant === "storage" ? "wood" : "fabric", it.finish);
  const bedding = m.fabric(p.bedding);
  const accent = m.fabric(p.accent);
  const accent2 = m.fabric(p.accent2, "velvet");

  let mattressTop = 0.58;
  let mattW = w - 0.08;
  let mattD = d - 0.16;

  switch (it.variant) {
    case "wooden": {
      const wood = main;
      const legH = 0.18;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.07, legH + 0.18, 0.07, wood, sx * (w / 2 - 0.035), 0, sz * (d / 2 - 0.05));
      k.slab(g, w, 0.18, d - 0.1, wood, 0, legH, 0.03, { grain: 2 });
      // Headboard: frame with horizontal slats.
      const hh = Math.max(1.0, it.h);
      k.slab(g, w + 0.04, hh, 0.05, wood, 0, 0, back + 0.03);
      for (let i = 0; i < 4; i++) k.slab(g, w - 0.1, 0.06, 0.03, m.wood(p.woodAccent), 0, 0.62 + i * 0.1, back + 0.065, { grain: 0 });
      k.slab(g, w + 0.08, 0.05, 0.08, wood, 0, hh, back + 0.03, { grain: 0 });
      k.slab(g, w, 0.4, 0.05, wood, 0, 0, d / 2 - 0.03, { grain: 0 });
      mattressTop = legH + 0.18 + 0.24;
      break;
    }
    case "storage": {
      k.rbox(g, w, 0.38, d - 0.06, 0.01, main, 0, 0.19, 0.03, { grain: 2 });
      k.slab(g, w - 0.02, 0.008, 0.002, m.metal("black"), 0, 0.2, d / 2);
      k.rbox(g, w + 0.06, Math.max(1.0, it.h), 0.07, 0.01, main, 0, Math.max(1.0, it.h) / 2, back + 0.035);
      k.slab(g, w * 0.9, 0.3, 0.03, m.fabric(p.fabric), 0, 0.65, back + 0.08);
      mattressTop = 0.38 + 0.24;
      mattW = w - 0.04;
      mattD = d - 0.1;
      break;
    }
    case "platform": {
      const wood = m.wood();
      k.slab(g, w - 0.1, 0.08, d - 0.2, m.metal("black"), 0, 0, 0.03);
      k.slab(g, w, 0.16, d - 0.06, wood, 0, 0.08, 0.03, { grain: 2 });
      k.slab(g, w + 0.9, 0.7, 0.06, wood, 0, 0.08, back + 0.03, { grain: 0 });
      k.rbox(g, w, 0.32, 0.12, 0.05, main, 0, 0.62, back + 0.1);
      for (const sx of [-1, 1]) k.slab(g, 0.4, 0.04, 0.32, wood, sx * (w / 2 + 0.25), 0.42, back + 0.19);
      mattressTop = 0.24 + 0.22;
      mattW = w - 0.12;
      mattD = d - 0.14;
      break;
    }
    case "wingback": {
      k.slab(g, w - 0.12, 0.08, d - 0.24, m.metal("black"), 0, 0, 0.03);
      k.rbox(g, w, 0.28, d - 0.08, 0.03, main, 0, 0.22, 0.04);
      const hh = Math.max(1.25, it.h + 0.1);
      k.rbox(g, w - 0.3, hh - 0.06, 0.16, 0.06, main, 0, (hh - 0.06) / 2 + 0.06, back + 0.08);
      for (const sx of [-1, 1]) {
        const wing = k.rbox(g, 0.24, hh, 0.32, 0.07, main, sx * (w / 2 - 0.1), hh / 2, back + 0.12);
        wing.rotation.y = sx * 0.32;
      }
      for (let i = 0; i < 6; i++) k.sphere(g, 0.012, m.fabric(p.fabric), -w / 2 + 0.3 + ((w - 0.6) * (i % 3)) / 2, 0.85 + Math.floor(i / 3) * 0.25, back + 0.165);
      break;
    }
    default: {
      // Upholstered with a channel-tufted headboard.
      k.slab(g, w - 0.12, 0.08, d - 0.24, m.metal("black"), 0, 0, 0.03);
      k.rbox(g, w, 0.28, d - 0.08, 0.03, main, 0, 0.22, 0.04);
      const hh = Math.max(1.0, it.h);
      k.rbox(g, w + 0.08, 0.36, 0.12, 0.02, main, 0, 0.18 + 0.08, back + 0.06);
      const n = Math.max(5, Math.round((w + 0.08) / 0.22));
      const cw = (w + 0.08) / n;
      for (let i = 0; i < n; i++) {
        k.rbox(g, cw - 0.006, hh - 0.36, 0.11, 0.045, main, -(w + 0.08) / 2 + cw * (i + 0.5), 0.36 + (hh - 0.36) / 2, back + 0.065);
      }
    }
  }

  // Mattress, duvet, pillows, throw — the same on every frame.
  const mz = back + 0.08 + mattD / 2;
  k.rbox(g, mattW, 0.22, mattD, 0.05, bedding, 0, mattressTop - 0.11, mz);
  // A real duvet: lies on the mattress, rolls over the sides and the foot and
  // hangs down over the mattress with folds; its head end is turned down.
  // It is a little wider and longer than the bed base, so it hangs over the
  // base's edge instead of into it.
  const head = mz - mattD / 2 + mattD * 0.28;
  const foot = d / 2 + 0.015;
  const duvetD = foot - head;
  const duvetZ = (foot + head) / 2;
  const top = mattressTop + 0.012;
  k.drape(g, w + 0.03, duvetD, 0.3, bedding, 0, top, duvetZ, { r: 0.07, loft: 0.04, back: true, backDrop: 0.06, seed: `${it.id}:duvet` });
  k.drape(g, w + 0.045, 0.3, 0.27, bedding, 0, top + 0.045, head + 0.15, { r: 0.05, loft: 0.04, creases: 0.8, front: false, back: true, backDrop: 0.05, seed: `${it.id}:fold` });
  // The throw across the foot, hanging lower than the duvet on both sides.
  k.drape(g, w + 0.06, 0.5, 0.36, accent, 0, top + 0.014, foot - 0.4, { r: 0.07, loft: 0.04, creases: 1.5, front: false, seed: `${it.id}:throw` });

  // Dressed like a styled bed: sleeping pillows leaning on the headboard, a
  // square cushion in front of each, a lumbar cushion in the middle.
  const lean = -0.36; // top tilted back towards the headboard
  const pairs = mattW > 1.3 ? [-1, 1] : [0];
  const pw = pairs.length === 2 ? Math.min(0.7, mattW / 2 - 0.05) : Math.min(0.7, mattW - 0.14);
  for (const s of pairs) {
    const px = s * (pairs.length === 2 ? pw / 2 + 0.02 : 0);
    const sp = k.pillow(g, pw, 0.48, 0.18, bedding, px, mattressTop + 0.22, back + 0.3);
    sp.rotation.x = lean;
    const cu = k.pillow(g, 0.46, 0.46, 0.16, s <= 0 ? accent : accent2, px + s * 0.04, mattressTop + 0.21, back + 0.45);
    cu.rotation.set(lean * 0.75, 0, s * 0.04);
  }
  const lumbar = k.pillow(g, Math.min(0.56, mattW * 0.4), 0.3, 0.15, pairs.length === 2 ? m.fabric(p.fabric) : accent2, 0, mattressTop + 0.15, back + 0.58);
  lumbar.rotation.x = -0.22;
}

/** The decorative panel on the wall behind the bed ("bed back"). Local: w along the wall, d thickness. */
export function bedBack(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, h, d } = it;
  const back = -d / 2;
  const top = Math.min(h, c.ceilingClear - 0.02);
  switch (it.variant) {
    case "upholstered-grid": {
      const veneer = m.byRole("wood", it.finish);
      k.slab(g, w, top, 0.02, veneer, 0, 0, back + 0.01, { grain: 1 });
      const rows = 3;
      const cols = Math.max(3, Math.round(w / 0.6));
      const tileH = 1.25 / rows;
      const tileW = (w * 0.62) / cols;
      for (let r = 0; r < rows; r++) {
        for (let cIdx = 0; cIdx < cols; cIdx++) {
          k.rbox(g, tileW - 0.01, tileH - 0.01, 0.07, 0.03, m.fabric(p.fabric), -(w * 0.62) / 2 + tileW * (cIdx + 0.5), 0.32 + tileH * (r + 0.5), back + 0.055);
        }
      }
      k.slab(g, w * 0.62 + 0.04, 0.015, 0.03, m.metal(), 0, 0.32 + 1.25, back + 0.035);
      break;
    }
    case "veneer-led": {
      const veneer = m.byRole("wood", it.finish);
      const bands = [0, 0.75, 1.5];
      for (let i = 0; i < bands.length; i++) {
        const y0 = bands[i];
        const y1 = i + 1 < bands.length ? bands[i + 1] - 0.03 : top;
        k.slab(g, w, y1 - y0, d - 0.01, veneer, 0, y0, back + (d - 0.01) / 2, { grain: 1 });
        if (i > 0) k.slab(g, w - 0.04, 0.012, 0.01, m.emissive("#ffd7a1", 3), 0, y0 - 0.02, back + 0.02, { cast: false });
      }
      break;
    }
    case "marble": {
      const stone = m.byRole("stone", it.finish ?? "white marble");
      const wood = m.wood();
      const mw = Math.min(w * 0.55, 2.2);
      k.slab(g, mw, top, d, stone, 0, 0, back + d / 2);
      for (const sx of [-1, 1]) {
        k.slab(g, (w - mw) / 2, top, d - 0.01, wood, sx * (mw / 2 + (w - mw) / 4), 0, back + (d - 0.01) / 2, { grain: 1 });
        k.slab(g, 0.02, top, d + 0.006, m.metal(), sx * (mw / 2 + 0.01), 0, back + d / 2);
      }
      break;
    }
    case "moulding": {
      const paint = m.wallPaint(shade(c.room.wallColor, -0.06));
      k.slab(g, w, top, 0.01, paint, 0, 0, back + 0.005);
      const frames = Math.max(2, Math.round(w / 0.9));
      const fw = w / frames;
      const trim = m.lacquer(shade(c.room.wallColor, 0.03), true);
      for (let i = 0; i < frames; i++) {
        const cx = -w / 2 + fw * (i + 0.5);
        const ow = fw - 0.16;
        for (const [yy, hh] of [
          [0.25, 0.9],
          [1.3, top - 1.5],
        ] as const) {
          if (hh < 0.2) continue;
          k.slab(g, ow, 0.03, 0.025, trim, cx, yy, back + 0.02);
          k.slab(g, ow, 0.03, 0.025, trim, cx, yy + hh, back + 0.02);
          k.slab(g, 0.03, hh + 0.03, 0.025, trim, cx - ow / 2, yy, back + 0.02);
          k.slab(g, 0.03, hh + 0.03, 0.025, trim, cx + ow / 2, yy, back + 0.02);
        }
      }
      break;
    }
    default: {
      // Fluted wood with an LED cove at the top.
      const wood = m.byRole("wood", it.finish);
      k.slab(g, w, top, 0.02, wood, 0, 0, back + 0.01, { grain: 1 });
      const pitch = 0.045;
      const n = Math.floor(w / pitch);
      const fluteH = top - 0.12;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + pitch * (i + 0.5);
        k.rbox(g, pitch - 0.008, fluteH, 0.03, 0.013, wood, x, fluteH / 2, back + 0.035, { grain: 1, cast: false });
      }
      k.slab(g, w, 0.05, d + 0.03, wood, 0, fluteH, back + (d + 0.03) / 2, { grain: 0 });
      k.slab(g, w - 0.04, 0.01, 0.01, m.emissive("#ffd49a", 3.5), 0, fluteH - 0.012, back + d + 0.01, { cast: false });
    }
  }
}

export function nightstand(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d, h } = it;
  const main = m.byRole("wood", it.finish);
  const metal = m.metal();
  let topY = h;
  switch (it.variant) {
    case "open-shelf": {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.03, h - 0.03, 0.03, m.metal("black"), sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03));
      k.slab(g, w, 0.03, d, main, 0, h - 0.03, 0);
      k.slab(g, w - 0.04, 0.02, d - 0.04, main, 0, 0.15, 0);
      k.slab(g, 0.18, 0.05, 0.13, m.fabric(p.accent), -w / 4 + 0.05, 0.17, 0);
      break;
    }
    case "round": {
      const r = Math.min(w, d) / 2;
      k.cyl(g, r, r, 0.035, main, 0, h - 0.0175, 0);
      k.cyl(g, 0.035, 0.035, h - 0.06, metal, 0, (h - 0.06) / 2 + 0.025, 0);
      k.cyl(g, r * 0.55, r * 0.6, 0.025, metal, 0, 0.0125, 0);
      break;
    }
    case "floating": {
      const y0 = 0.3;
      k.slab(g, w, h - y0, d, main, 0, y0, 0);
      k.slab(g, w - 0.02, (h - y0) / 2 - 0.01, 0.01, m.wood(p.woodAccent), 0, y0 + 0.01, d / 2 + 0.004, { grain: 0 });
      k.slab(g, 0.12, 0.012, 0.012, metal, 0, y0 + (h - y0) / 2 - 0.05, d / 2 + 0.015);
      topY = h;
      break;
    }
    case "cane": {
      k.slab(g, w, h - 0.1, d, main, 0, 0.1, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.035, 0.1, 0.035, main, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
      k.slab(g, w - 0.06, h - 0.2, 0.005, m.cane(), 0, 0.14, d / 2 + 0.003, { cast: false });
      break;
    }
    default: {
      const legH = 0.1;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.03, legH, 0.03, metal, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
      k.slab(g, w, h - legH, d, main, 0, legH, 0, { grain: 0 });
      const dh = (h - legH - 0.03) / 2;
      for (let i = 0; i < 2; i++) {
        const y = legH + 0.01 + i * (dh + 0.005);
        k.slab(g, w - 0.03, dh - 0.004, 0.012, main, 0, y, d / 2 + 0.006, { grain: 0 });
        k.slab(g, 0.1, 0.012, 0.015, metal, 0, y + dh / 2, d / 2 + 0.02);
      }
    }
  }
  // Table lamp + a book.
  const lx = -w * 0.15;
  k.cyl(g, 0.06, 0.07, 0.03, metal, lx, topY + 0.015, -0.02);
  k.cyl(g, 0.012, 0.012, 0.3, metal, lx, topY + 0.18, -0.02);
  k.cyl(g, 0.11, 0.15, 0.2, m.shade(), lx, topY + 0.38, -0.02, 32, { cast: false });
  k.lamp(g, lx, topY + 0.36, -0.02, 2.2);
  k.slab(g, 0.16, 0.035, 0.22, m.fabric(p.accent2), w * 0.2, topY, 0.03);
}

export function wardrobe(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d } = it;
  const loft = it.variant === "hinged-loft";
  const h = loft ? c.ceilingClear - 0.01 : Math.min(it.h, c.ceilingClear - 0.01);
  const body = m.byRole("lacquer", it.finish);
  const kick = 0.08;
  k.slab(g, w - 0.04, kick, d - 0.06, m.lacquer("#3a3633", true), 0, 0, -0.03);
  k.slab(g, w, h - kick, d - 0.02, body, 0, kick, -0.01);
  const front = d / 2 + 0.002;
  const metal = it.variant === "glass" ? m.metal("black") : m.metal();
  if (it.variant === "sliding") {
    const n = w > 2.2 ? 3 : 2;
    const pw = w / n + 0.03;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      const z = front + (i % 2 ? 0.035 : 0.01);
      k.slab(g, pw, h - kick - 0.06, 0.02, body, x, kick + 0.02, z);
      for (const sx of [-1, 1]) k.slab(g, 0.03, h - kick - 0.06, 0.03, m.metal("steel"), x + sx * (pw / 2 - 0.015), kick + 0.02, z);
      k.slab(g, 0.01, h - kick - 0.06, 0.02, m.wood(p.woodAccent), x, kick + 0.02, z + 0.011);
    }
    k.slab(g, w, 0.05, 0.08, m.metal("steel"), 0, h - 0.05, front + 0.03);
    return;
  }
  const sh = loft ? Math.min(2.1, h - 0.35) : h;
  const n = Math.max(2, Math.round(w / 0.5));
  const sw = w / n;
  const shutter = it.variant === "glass" ? m.frosted() : body;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + sw * (i + 0.5);
    if (it.variant === "glass") {
      // Aluminium frame, fluted glass, lit shelves and hanging clothes behind.
      k.slab(g, sw - 0.006, sh - kick - 0.004, 0.012, shutter, x, kick + 0.002, front + 0.005, { cast: false });
      for (const sx of [-1, 1]) k.slab(g, 0.022, sh - kick, 0.025, metal, x + sx * (sw / 2 - 0.011), kick, front + 0.012);
      k.slab(g, sw, 0.022, 0.025, metal, x, kick, front + 0.012);
      k.slab(g, sw, 0.022, 0.025, metal, x, sh - 0.022, front + 0.012);
    } else {
      k.slab(g, sw - 0.004, sh - kick - 0.004, 0.018, shutter, x, kick + 0.002, front + 0.009);
    }
    const handleSide = i % 2 === 0 ? 1 : -1;
    const hx = x + handleSide * (sw / 2 - 0.05);
    k.slab(g, 0.015, 0.5, 0.02, metal, hx, 0.85, front + 0.03);
  }
  if (it.variant === "glass") {
    k.slab(g, w - 0.06, 0.012, 0.02, m.emissive("#fff2dc", 2.5), 0, sh - 0.06, -0.01, { cast: false });
    const hang = ["#8a8f96", "#d8cbb4", "#3d4a5c", "#b56b4e", "#e9e5df", "#55606b"];
    for (let i = 0; i < Math.floor(w / 0.12); i++) {
      k.slab(g, 0.04, 0.85, 0.42, m.fabric(hang[i % hang.length]), -w / 2 + 0.12 + i * 0.11, sh - 1.15, 0);
    }
  }
  if (loft) {
    const lh = h - sh - 0.004;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + sw * (i + 0.5);
      k.slab(g, sw - 0.004, lh, 0.018, body, x, sh + 0.004, front + 0.009);
      k.slab(g, 0.12, 0.012, 0.02, metal, x, sh + 0.06, front + 0.03);
    }
  }
}

export function dresser(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, p } = c;
  const { w, d, h } = it;
  const main = m.byRole("wood", it.finish);
  const metal = m.metal();
  if (it.variant === "chest") {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.035, 0.14, 0.035, main, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
    k.slab(g, w, h - 0.14, d, main, 0, 0.14, 0, { grain: 0 });
    const rows = 4;
    const dh = (h - 0.16) / rows;
    for (let r = 0; r < rows; r++) {
      k.slab(g, w - 0.03, dh - 0.006, 0.012, main, 0, 0.15 + r * dh, d / 2 + 0.006, { grain: 0 });
      for (const sx of [-1, 1]) k.cyl(g, 0.012, 0.012, 0.02, metal, sx * w * 0.25, 0.15 + r * dh + dh / 2, d / 2 + 0.02).rotation.x = Math.PI / 2;
    }
    return;
  }
  // Wall-hung console with drawers, a framed mirror above and a stool.
  const y0 = 0.42;
  const ch = 0.32;
  k.slab(g, w, ch, d, main, 0, y0, 0, { grain: 0 });
  for (const sx of [-1, 1]) {
    k.slab(g, w / 2 - 0.02, ch - 0.02, 0.012, main, sx * w / 4, y0 + 0.01, d / 2 + 0.006, { grain: 0 });
    k.slab(g, 0.08, 0.012, 0.015, metal, sx * w / 4, y0 + ch / 2, d / 2 + 0.02);
  }
  const mh = 0.9;
  const mw = Math.min(w * 0.7, 0.8);
  k.slab(g, mw + 0.04, mh + 0.04, 0.025, metal, 0, y0 + ch + 0.25, -d / 2 + 0.0125);
  k.slab(g, mw, mh, 0.01, m.mirror(), 0, y0 + ch + 0.27, -d / 2 + 0.03, { cast: false });
  k.cyl(g, 0.2, 0.2, 0.08, m.fabric(p.accent, "velvet"), 0, 0.42, d / 2 + 0.3);
  k.cyl(g, 0.18, 0.15, 0.38, m.metal(), 0, 0.19, d / 2 + 0.3, 24);
  k.cyl(g, 0.04, 0.05, 0.12, m.ceramic("#e9dfd1"), w / 2 - 0.12, y0 + ch + 0.06, 0);
}

export function bench(c: BuildCtx, it: Item, g: Group): void {
  const { k, m } = c;
  const { w, d, h } = it;
  const main = m.byRole("fabric", it.finish);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.slab(g, 0.03, h - 0.12, 0.03, m.metal(), sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05));
  k.rbox(g, w, 0.14, d, 0.04, main, 0, h - 0.07, 0);
}

/** Lighten (amount > 0) or darken a hex colour. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  const r = ch((n >> 16) & 255);
  const gg = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, "0")}`;
}
