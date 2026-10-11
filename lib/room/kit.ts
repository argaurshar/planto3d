// A tiny modelling kit for the furniture builders: boxes, rounded boxes,
// cylinders and spheres placed by centre, with UVs in real metres so the
// procedural textures (grain, weave, marble) show at true scale on every face.

import type { Materials } from "./materials";

export type ThreeNS = typeof import("three");
type Object3D = import("three").Object3D;
type Group = import("three").Group;
type Mesh = import("three").Mesh;
type Material = import("three").Material;
type BufferGeometry = import("three").BufferGeometry;

/** `three` plus the example modules the room needs, loaded once in the browser. */
export interface ThreeBundle {
  THREE: ThreeNS;
  RoundedBoxGeometry: typeof import("three/examples/jsm/geometries/RoundedBoxGeometry.js").RoundedBoxGeometry;
}

let bundle: Promise<ThreeBundle> | null = null;

/** Load three.js and its helpers (code-split: never in the server bundle). */
export function loadThree(): Promise<ThreeBundle> {
  if (!bundle) {
    bundle = (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      return { THREE, RoundedBoxGeometry };
    })();
  }
  return bundle;
}

type Axis = 0 | 1 | 2;

/**
 * Re-map a geometry's UVs to metres: each vertex is projected on the plane its
 * normal faces, and wood grain (texture v) runs along `grain` (default: the
 * geometry's longest axis), so a long shelf has grain along its length.
 */
export function worldUV(geo: BufferGeometry, grain?: Axis): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  if (!pos || !nor) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  const g: Axis = grain ?? (size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2);
  const uv = new Float32Array(pos.count * 2);
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    p[0] = pos.getX(i);
    p[1] = pos.getY(i);
    p[2] = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const a: Axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    let [uAxis, vAxis] = a === 0 ? [2, 1] : a === 1 ? [0, 2] : [0, 1];
    if (uAxis === g) [uAxis, vAxis] = [vAxis, uAxis];
    uv[i * 2] = p[uAxis];
    uv[i * 2 + 1] = p[vAxis];
  }
  // Every geometry the kit makes already has a uv attribute of the right size:
  // overwrite it in place (no BufferAttribute constructor needed here).
  const attr = geo.getAttribute("uv") as import("three").BufferAttribute | undefined;
  if (attr && attr.count === pos.count) {
    (attr.array as Float32Array).set(uv);
    attr.needsUpdate = true;
  }
}

export interface PartOpts {
  /** Axis the texture grain runs along (0 = x, 1 = y, 2 = z). */
  grain?: Axis;
  /** Skip world UVs (keep the geometry's own 0..1 UVs, e.g. a rug or a canvas). */
  rawUV?: boolean;
  /** Cast shadows (default true). */
  cast?: boolean;
  name?: string;
}

export interface DrapeOpts extends PartOpts {
  /** Radius of the roll over the edge. */
  r?: number;
  /** How much the top rises away from the sides (a filled duvet). */
  loft?: number;
  /** Crease and fold strength (1 = a made bed). */
  creases?: number;
  /** Which edges hang down (default: left, right and front). */
  left?: boolean;
  right?: boolean;
  front?: boolean;
  back?: boolean;
  /** How far the back edge hangs when it does (default: just rolls over). */
  backDrop?: number;
  /** Seed for the creases (an item id), so a room always builds the same. */
  seed?: string;
}

/** Builds meshes into a parent with one call per part. */
export class Kit {
  readonly T: ThreeBundle;
  readonly THREE: ThreeNS;
  readonly m: Materials;
  /** Lamp strength for the lighting mood (brighter in the evening and at night). */
  lampScale = 1;
  /**
   * Edge radius for boxes (metres). Real furniture has slightly eased edges
   * that catch the light; dead-sharp CG edges are a big part of the "plastic"
   * look. The scene turns it on for furniture only.
   */
  bevel = 0;

  constructor(T: ThreeBundle, m: Materials) {
    this.T = T;
    this.THREE = T.THREE;
    this.m = m;
  }

  group(parent?: Object3D, name?: string): Group {
    const g = new this.THREE.Group();
    if (name) g.name = name;
    parent?.add(g);
    return g;
  }

  private finish(parent: Object3D, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, o: PartOpts): Mesh {
    if (!o.rawUV) worldUV(geo, o.grain);
    const mesh = new this.THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = o.cast !== false;
    mesh.receiveShadow = true;
    if (o.name) mesh.name = o.name;
    parent.add(mesh);
    return mesh;
  }

  /** A box of size w×h×d centred at (x, y, z). */
  box(parent: Object3D, w: number, h: number, d: number, mat: Material, x = 0, y = 0, z = 0, o: PartOpts = {}): Mesh {
    const W = Math.max(0.002, w);
    const H = Math.max(0.002, h);
    const D = Math.max(0.002, d);
    const min = Math.min(W, H, D);
    const geo =
      this.bevel > 0 && min >= 0.012
        ? new this.T.RoundedBoxGeometry(W, H, D, 2, Math.min(this.bevel, min * 0.25))
        : new this.THREE.BoxGeometry(W, H, D);
    return this.finish(parent, geo, mat, x, y, z, o);
  }

  /** A box sitting on y0 (bottom at y0), centred on x/z — the common case. */
  slab(parent: Object3D, w: number, h: number, d: number, mat: Material, x: number, y0: number, z: number, o: PartOpts = {}): Mesh {
    return this.box(parent, w, h, d, mat, x, y0 + h / 2, z, o);
  }

  /** A rounded box (cushions, mattresses, upholstery). */
  rbox(parent: Object3D, w: number, h: number, d: number, r: number, mat: Material, x = 0, y = 0, z = 0, o: PartOpts = {}): Mesh {
    const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    const geo = new this.T.RoundedBoxGeometry(Math.max(0.004, w), Math.max(0.004, h), Math.max(0.004, d), 3, rr);
    return this.finish(parent, geo, mat, x, y, z, o);
  }

  /**
   * A pillow or cushion: a soft panel w×h, t thick in the middle, pinched to a
   * seam all round, with the sides drawn in so the corners stand out the way a
   * stuffed cover does. Its faces look along ±z; centred at (x, y, z).
   */
  pillow(parent: Object3D, w: number, h: number, t: number, mat: Material, x = 0, y = 0, z = 0, o: PartOpts = {}): Mesh {
    const geo = new this.THREE.BoxGeometry(1, 1, 1, 18, 14, 2);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const u = Math.max(-1, Math.min(1, pos.getX(i) * 2));
      const v = Math.max(-1, Math.min(1, pos.getY(i) * 2));
      const side = Math.sign(pos.getZ(i));
      const puff = Math.pow(1 - Math.pow(Math.abs(u), 2.4), 0.55) * Math.pow(1 - Math.pow(Math.abs(v), 2.4), 0.55);
      const drawX = 1 - 0.07 * (1 - v * v);
      const drawY = 1 - 0.09 * (1 - u * u);
      pos.setXYZ(i, (u / 2) * w * drawX, (v / 2) * h * drawY, side * (t / 2) * Math.max(0.06, puff));
    }
    geo.computeVertexNormals();
    return this.finish(parent, geo, mat, x, y, z, o);
  }

  /**
   * A cloth draped over a flat top w×d (centred on x, z, lying at height y):
   * it lies on the top with a gentle loft, rolls over the chosen edges with
   * radius `r` and hangs `drop` down them, with soft creases on the top and
   * folds on the hanging sides that deepen towards the hem. Local frame like
   * the furniture: x across, z towards the front (+z).
   */
  drape(parent: Object3D, w: number, d: number, drop: number, mat: Material, x: number, y: number, z: number, o: DrapeOpts = {}): Mesh {
    const THREE = this.THREE;
    const r = Math.min(o.r ?? 0.05, w / 4, d / 4);
    const hangs = { left: o.left ?? true, right: o.right ?? true, front: o.front ?? true, back: o.back ?? false };
    const backDrop = o.backDrop ?? r;
    const arc = (r * Math.PI) / 2;
    // Unfolded length past the flat top (which ends r before the edge): the roll, then the straight hang.
    const extra = (on: boolean, len: number) => (on ? arc - r + Math.max(0, len - r) : 0);
    const x0 = -w / 2 - extra(hangs.left, drop);
    const x1 = w / 2 + extra(hangs.right, drop);
    const z0 = -d / 2 - extra(hangs.back, backDrop);
    const z1 = d / 2 + extra(hangs.front, drop);
    const sx = Math.max(16, Math.round((x1 - x0) / 0.025));
    const sz = Math.max(12, Math.round((z1 - z0) / 0.025));
    const geo = new THREE.PlaneGeometry(1, 1, sx, sz);
    const pos = geo.getAttribute("position");
    const rnd = seeded(o.seed ?? "drape");
    const ph = Array.from({ length: 8 }, () => rnd() * Math.PI * 2);
    const creases = o.creases ?? 1;
    const loft = o.loft ?? 0;
    // One axis of the fold: flat on the top, round over the edge, then straight down.
    const fold = (a: number, half: number, lo: boolean, hi: boolean, lenLo: number, lenHi: number) => {
      const s = a < 0 ? -1 : 1;
      const on = s < 0 ? lo : hi;
      const len = s < 0 ? lenLo : lenHi;
      const e = Math.abs(a) - (half - r);
      if (!on || e <= 0) return { p: a, down: 0, t: 0, s };
      if (e <= arc) {
        const th = e / r;
        return { p: s * (half - r + r * Math.sin(th)), down: r * (1 - Math.cos(th)), t: (th / (Math.PI / 2)) * 0.25, s };
      }
      const hgt = e - arc;
      return { p: s * (half + hgt * 0.05), down: r + hgt, t: 0.25 + 0.75 * Math.min(1, hgt / Math.max(0.01, len - r)), s };
    };
    for (let i = 0; i < pos.count; i++) {
      const u = x0 + (pos.getX(i) + 0.5) * (x1 - x0);
      const v = z0 + (0.5 - pos.getY(i)) * (z1 - z0);
      const fx = fold(u, w / 2, hangs.left, hangs.right, drop, drop);
      const fz = fold(v, d / 2, hangs.back, hangs.front, backDrop, drop);
      // Where the back edge only rolls over, the side hang shortens into it, so the corner rounds off.
      if (fz.s < 0 && fz.t > 0 && fx.down > r) fx.down = r + (fx.down - r) * (1 - Math.min(1, fz.t / 0.25));
      const hang = Math.max(fx.t, fz.t);
      // Loft: the top rises a little away from the sides, like a filled duvet
      // (across the width only, so layers laid on top follow it).
      const lift = hang > 0 ? 0 : loft * Math.min(1, Math.max(0, w / 2 - Math.abs(u)) / 0.25);
      // Creases on the top, folds along the hanging sides, growing towards the hem.
      const topCrease = 0.005 * creases * (Math.sin(u * 7.1 + v * 2.3 + ph[0]) * Math.sin(v * 5.3 - u * 1.7 + ph[1]) + 0.5 * Math.sin(u * 13.7 - v * 9.1 + ph[2]));
      const alongX = fz.t > fx.t ? u : v;
      // A few broad, irregular folds (the phase wanders, so they are not a regular wave).
      const wander = 0.9 * Math.sin(alongX * 1.7 + ph[6]) + 0.5 * Math.sin(alongX * 3.3 + ph[7]);
      const sideFold = (0.003 + 0.016 * hang) * creases * (Math.sin(alongX * 6.4 + wander + ph[3]) + 0.45 * Math.sin(alongX * 10.9 - wander + ph[4]) + 0.35 * Math.sin(alongX * 2.6 + ph[5]));
      const off = hang > 0 ? sideFold : topCrease;
      // Push along the surface normal: up on the top, outwards on the sides.
      const nx = fx.t > 0 ? fx.s * Math.min(1, fx.t * 4) : 0;
      const nz = fz.t > 0 ? fz.s * Math.min(1, fz.t * 4) : 0;
      const ny = Math.max(0, 1 - Math.abs(nx) - Math.abs(nz));
      pos.setXYZ(i, fx.p + nx * off, lift - Math.max(fx.down, fz.down) + ny * off, fz.p + nz * off);
    }
    geo.computeVertexNormals();
    const mesh = this.finish(parent, geo, mat, x, y, z, o);
    return mesh;
  }

  /** A cylinder (radius top/bottom) of height h centred at (x, y, z). */
  cyl(parent: Object3D, rt: number, rb: number, h: number, mat: Material, x = 0, y = 0, z = 0, seg = 28, o: PartOpts = {}): Mesh {
    const geo = new this.THREE.CylinderGeometry(rt, rb, h, seg);
    return this.finish(parent, geo, mat, x, y, z, { grain: 1, ...o });
  }

  sphere(parent: Object3D, r: number, mat: Material, x = 0, y = 0, z = 0, scale: [number, number, number] = [1, 1, 1], o: PartOpts = {}): Mesh {
    const geo = new this.THREE.SphereGeometry(r, 20, 14);
    const m = this.finish(parent, geo, mat, x, y, z, o);
    m.scale.set(...scale);
    return m;
  }

  torus(parent: Object3D, r: number, tube: number, mat: Material, x = 0, y = 0, z = 0, o: PartOpts = {}): Mesh {
    const geo = new this.THREE.TorusGeometry(r, tube, 10, 32);
    return this.finish(parent, geo, mat, x, y, z, { rawUV: true, ...o });
  }

  /** A warm point light (lamps). Never casts shadows: lamps are many, shadows are costly. */
  lamp(parent: Object3D, x: number, y: number, z: number, intensity = 6, color = "#ffd6a0", distance = 5): void {
    const l = new this.THREE.PointLight(color, intensity * this.lampScale, distance, 2);
    l.position.set(x, y, z);
    l.castShadow = false;
    parent.add(l);
  }
}

/** Deterministic pseudo-random sequence from a string (item ids), so a room always builds the same. */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
