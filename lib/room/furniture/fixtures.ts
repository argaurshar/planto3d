// Fixtures on the ceiling and high on the walls: a ceiling fan and a split AC.
// Both place themselves vertically (the group sits on the floor): the fan
// hangs from the ceiling over its own spot (true ceiling or false-ceiling
// band), the AC sits at its elevation, never into the ceiling.

import type { Item } from "../types";
import type { BuildCtx } from "./index";
import { ceilingAt, ceilingDrop } from "../geometry";
import { seeded, worldUV } from "../kit";

type Group = import("three").Group;
type Material = import("three").Material;

/** One fan blade in the xz plane, from the hub outwards along +x: narrow root, rounded tip. */
function bladeGeometry(c: BuildCtx, length: number, root: number, tip: number) {
  const THREE = c.k.THREE;
  const s = new THREE.Shape();
  s.moveTo(0, -root / 2);
  s.lineTo(length - tip / 2, -tip / 2);
  s.absarc(length - tip / 2, 0, tip / 2, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(0, root / 2);
  s.lineTo(0, -root / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 12 });
  // Shape plane (x, y) → floor plane (x, z), thickness up.
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function ceilingFan(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, room } = c;
  const THREE = k.THREE;
  const top = ceilingAt(room, it.x, it.z);
  const drop = ceilingDrop(room, it);
  const wood = it.variant === "wood";
  const light = it.variant === "light";
  const body: Material = it.finish ? m.byRole("lacquer", it.finish) : wood ? m.metal("black") : m.lacquer("#f1efea");
  const bladeMat: Material = wood ? m.byRole("wood", it.finish && /wood|oak|teak|walnut|ash|wenge/.test(it.finish) ? it.finish : "walnut") : body;
  const bladeY = top - drop + (light ? 0.1 : 0.07);

  // Canopy against the ceiling, and the downrod.
  k.cyl(g, 0.075, 0.085, 0.06, body, 0, top - 0.03, 0, 28, { cast: false });
  const rodTop = top - 0.06;
  const rodBottom = bladeY + 0.06;
  if (rodTop - rodBottom > 0.02) k.cyl(g, 0.012, 0.012, rodTop - rodBottom, light ? body : m.metal(wood ? "black" : "steel"), 0, (rodTop + rodBottom) / 2, 0, 12);

  // Motor housing: a short drum with soft top and bottom caps.
  const r = light ? 0.13 : wood ? 0.1 : 0.115;
  k.cyl(g, r * 0.82, r, 0.05, body, 0, bladeY + 0.035, 0, 36);
  k.cyl(g, r, r, 0.035, body, 0, bladeY, 0, 36);
  k.sphere(g, r, body, 0, bladeY - 0.017, 0, [1, 0.28, 1]);

  // Blades on a turned hub (each fan stops at its own angle), pitched a little.
  const hub = k.group(g);
  hub.position.y = bladeY;
  hub.rotation.y = seeded(it.id)() * Math.PI * 2;
  const n = wood ? 4 : 3;
  const length = Math.max(0.2, it.w / 2 - r * 0.7);
  const geo = bladeGeometry(c, length, wood ? 0.1 : 0.085, wood ? 0.13 : 0.12);
  worldUV(geo, 0);
  for (let i = 0; i < n; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / n) * Math.PI * 2;
    hub.add(arm);
    const blade = new THREE.Mesh(geo, bladeMat);
    blade.position.set(r * 0.7, 0, 0);
    blade.rotation.x = 0.16;
    blade.castShadow = true;
    blade.receiveShadow = true;
    arm.add(blade);
    // The blade iron that holds it to the motor.
    k.box(arm, 0.12, 0.012, 0.035, m.metal(wood ? "black" : "steel"), r * 0.7 + 0.02, -0.004, 0);
  }

  if (light) {
    // Opal glass bowl under the motor, lit.
    k.sphere(g, 0.12, m.emissive("#fff4e2", 0.7), 0, bladeY - 0.03, 0, [1, 0.42, 1], { cast: false });
    // Low enough under the bowl that it lights the room, not just the ceiling above it.
    k.lamp(g, 0, bladeY - 0.2, 0, 2.2, "#ffe3bd", 6);
  }
}

export function ac(c: BuildCtx, it: Item, g: Group): void {
  const { k, m, room } = c;
  const { w, d, h } = it;
  const ceil = ceilingAt(room, it.x, it.z);
  const y0 = Math.max(0.3, Math.min(it.elevation ?? ceil - 0.15 - h, ceil - h - 0.03));
  const cy = y0 + h / 2;
  const back = -d / 2;
  // Semi-matte plastic: a downlight right above it should not flare.
  const shell: Material = it.finish ? m.byRole("lacquer", it.finish) : m.lacquer("#f4f4f2", true);
  const dark = m.lacquer("#2a2c2e", true);
  const slim = it.variant === "slim";

  // Body: the classic unit is a soft, rounded box; the slim one is crisp with a flat glossy front.
  k.rbox(g, w, h, d, slim ? 0.012 : 0.05, shell, 0, cy, 0);
  if (slim) {
    k.box(g, w - 0.02, h * 0.62, 0.006, m.lacquer("#fbfbfa"), 0, cy + h * 0.12, d / 2 + 0.002);
  } else {
    // The lift-up front panel's seam.
    k.box(g, w - 0.08, 0.004, 0.004, dark, 0, cy + h * 0.18, d / 2 - 0.002, { cast: false });
  }
  // Air outlet along the bottom front, and the swing vane across it.
  const outW = w - (slim ? 0.08 : 0.14);
  k.box(g, outW, 0.045, d * 0.42, dark, 0, y0 + 0.03, d / 2 - d * 0.21 - 0.004, { cast: false });
  const vane = k.box(g, outW, 0.006, 0.07, shell, 0, y0 + 0.012, d / 2 - 0.03);
  vane.rotation.x = 0.55;
  // Intake grille on top.
  for (let i = 0; i < 6; i++) k.box(g, w - 0.12, 0.003, 0.006, dark, 0, y0 + h + 0.0005, back + 0.04 + i * ((d - 0.08) / 5), { cast: false });
  // Display window with a small status light.
  const front = d / 2 + (slim ? 0.007 : 0.001);
  k.box(g, 0.07, 0.022, 0.004, m.screen(), w / 2 - 0.12, cy - h * 0.12, front, { cast: false });
  k.box(g, 0.006, 0.006, 0.003, m.emissive("#7fd3ff", 1.4), w / 2 - 0.1, cy - h * 0.12, front + 0.003, { cast: false });
}
