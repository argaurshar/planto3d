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

/** Builds meshes into a parent with one call per part. */
export class Kit {
  readonly T: ThreeBundle;
  readonly THREE: ThreeNS;
  readonly m: Materials;

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
    const geo = new this.THREE.BoxGeometry(Math.max(0.002, w), Math.max(0.002, h), Math.max(0.002, d));
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
    const l = new this.THREE.PointLight(color, intensity, distance, 2);
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
