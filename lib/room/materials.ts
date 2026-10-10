// Physically based materials with procedural textures drawn once on canvases:
// wood grain, floor planks, tiles, marble, woven fabric, rugs, art. No image
// files, so the static build stays self-contained. Every texture is authored in
// METRES (see `worldUV` in kit.ts), so a 2 m wardrobe and a 0.4 m drawer front
// show grain at the same real scale.
//
// Browser only: textures need a <canvas>.

import type { FloorFinish } from "./types";
import { COLOR_WORDS, STYLES, WOOD_WORDS, type MetalKind, type Palette, type StoneKind, type WoodSpecies } from "./styles";
import type { StyleId } from "./types";

type ThreeNS = typeof import("three");
type Mat = import("three").Material;
type Tex = import("three").Texture;

// ---------------------------------------------------------------------------
// Noise

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Tileable 2D value noise on a `cells` grid, sampled at u,v in [0,1). */
function makeNoise(cells: number, seed: number) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x: number, y: number) => g[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  return (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(noises: Array<(u: number, v: number) => number>, u: number, v: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (const n of noises) {
    sum += n(u, v) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

// ---------------------------------------------------------------------------
// Texture painters (each returns a canvas)

const WOOD_COLORS: Record<WoodSpecies, { light: string; dark: string }> = {
  oak: { light: "#c49a6c", dark: "#9a6f45" },
  "white-oak": { light: "#ddc6a4", dark: "#bc9f78" },
  walnut: { light: "#8a5f3f", dark: "#5a3a25" },
  teak: { light: "#b07a46", dark: "#7e5028" },
  ash: { light: "#e3d3b8", dark: "#c7b291" },
  wenge: { light: "#5b4334", dark: "#2f221b" },
};

/** Wood grain, grain running along v. Texture spans 0.6 m. */
function paintWood(species: WoodSpecies, seed = 7): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const n1 = makeNoise(6, seed);
  const n2 = makeNoise(24, seed + 1);
  const n3 = makeNoise(96, seed + 2);
  const fine = makeNoise(256, seed + 3);
  const [lr, lg, lb] = hexToRgb(WOOD_COLORS[species].light);
  const [dr, dg, db] = hexToRgb(WOOD_COLORS[species].dark);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      // Stretch along v so streaks run with the grain.
      const warp = fbm([n1, n2], u, v * 0.15) * 3.2;
      const ring = 0.5 + 0.5 * Math.sin((u * 26 + warp) * Math.PI * 2);
      const streak = fbm([n2, n3], u * 1.0, v * 0.08);
      let t = Math.pow(ring, 2.2) * 0.55 + streak * 0.45;
      t += (fine(u, v * 0.25) - 0.5) * 0.18;
      t = Math.min(1, Math.max(0, t));
      const i = (y * S + x) * 4;
      img.data[i] = lr + (dr - lr) * t;
      img.data[i + 1] = lg + (dg - lg) * t;
      img.data[i + 2] = lb + (db - lb) * t;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Engineered wood planks, 0.19 m × 1.2 m, staggered. Texture spans 2.4 m. */
function paintPlanks(species: WoodSpecies): HTMLCanvasElement {
  const S = 2048;
  const [c, ctx] = canvas(S);
  const wood = paintWood(species, 11);
  const plankW = S * (0.19 / 2.4);
  const plankL = S * (1.2 / 2.4);
  const r = rng(99);
  const cols = Math.ceil(S / plankW);
  // Base fill so no texel is ever transparent (it would show the material's white).
  ctx.drawImage(wood, 0, 0, S, S);
  const srcW = wood.width * (0.19 / 0.6);
  const srcH = wood.height * 0.5;
  for (let col = 0; col < cols; col++) {
    const offset = r() * plankL;
    for (let y = -plankL; y < S + plankL; y += plankL) {
      const top = y + offset;
      const sx = r() * (wood.width - srcW);
      const sy = r() * (wood.height - srcH);
      ctx.save();
      ctx.beginPath();
      ctx.rect(col * plankW, top, plankW, plankL);
      ctx.clip();
      // Wood canvas is 0.6 m wide; a plank is 0.19 m → draw a slice scaled 1:1 in metres.
      ctx.drawImage(wood, sx, sy, srcW, srcH, col * plankW, top, plankW, plankL);
      ctx.fillStyle = `rgba(${r() > 0.5 ? "255,240,220" : "40,25,10"},${r() * 0.08})`;
      ctx.fillRect(col * plankW, top, plankW, plankL);
      ctx.restore();
      ctx.fillStyle = "rgba(30,18,8,0.55)";
      ctx.fillRect(col * plankW, top, plankW, 2);
    }
    ctx.fillStyle = "rgba(30,18,8,0.45)";
    ctx.fillRect(col * plankW, 0, 2, S);
  }
  return c;
}

const STONE_COLORS: Record<StoneKind, { base: string; vein: string; vein2: string }> = {
  "white-marble": { base: "#f1efea", vein: "#8f8b85", vein2: "#c9c5be" },
  "grey-marble": { base: "#c9c8c5", vein: "#5f5d5a", vein2: "#a3a19d" },
  "beige-marble": { base: "#e6dac6", vein: "#a88e6c", vein2: "#cbb89a" },
  "black-marble": { base: "#2a2927", vein: "#d8d4cc", vein2: "#55524e" },
};

/** Marble with turbulent veins. Texture spans 1.2 m. */
function paintMarble(kind: StoneKind, seed = 3, S = 1024): HTMLCanvasElement {
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const ns = [makeNoise(4, seed), makeNoise(8, seed + 1), makeNoise(16, seed + 2), makeNoise(48, seed + 3)];
  const col = STONE_COLORS[kind];
  const [br, bg, bb] = hexToRgb(col.base);
  const [vr, vg, vb] = hexToRgb(col.vein);
  const [wr, wg, wb] = hexToRgb(col.vein2);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const turb = fbm(ns, u, v);
      const t = Math.abs(Math.sin((u * 2.2 + v * 1.3 + turb * 3.5) * Math.PI));
      const vein = Math.pow(1 - t, 18);
      const soft = Math.pow(1 - t, 4) * 0.35;
      const cloud = (fbm(ns, u * 1.7 + 3, v * 1.7) - 0.5) * 0.12;
      const i = (y * S + x) * 4;
      const k = Math.min(1, vein);
      img.data[i] = br * (1 + cloud) * (1 - k - soft) + vr * k + wr * soft;
      img.data[i + 1] = bg * (1 + cloud) * (1 - k - soft) + vg * k + wg * soft;
      img.data[i + 2] = bb * (1 + cloud) * (1 - k - soft) + vb * k + wb * soft;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Large-format vitrified tiles (0.6 m) with soft veining and grout. Texture spans 1.2 m. */
function paintTiles(kind: StoneKind): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S);
  ctx.drawImage(paintMarble(kind, 21, 512), 0, 0, S, S);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = "rgba(120,112,100,0.55)";
  for (const p of [0, S / 2]) {
    ctx.fillRect(p, 0, 3, S);
    ctx.fillRect(0, p, S, 3);
  }
  return c;
}

/** Woven textile, near-white so the material colour tints it. Texture spans 0.25 m. */
function paintFabric(seed = 5): HTMLCanvasElement {
  const S = 512;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const mottle = makeNoise(8, seed);
  const fine = makeNoise(128, seed + 1);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const weave = ((x >> 2) + (y >> 2)) % 2 === 0 ? 0.04 : -0.04;
      const t = 0.9 + weave + (mottle(x / S, y / S) - 0.5) * 0.12 + (fine(x / S, y / S) - 0.5) * 0.1;
      const val = Math.max(0, Math.min(255, t * 255));
      const i = (y * S + x) * 4;
      img.data[i] = val;
      img.data[i + 1] = val;
      img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Barely-there roller texture for painted walls. Texture spans 1 m. */
function paintWallNoise(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  const img = ctx.createImageData(S, S);
  const n = makeNoise(32, 13);
  const f = makeNoise(128, 14);
  for (let i = 0; i < S * S; i++) {
    const u = (i % S) / S;
    const v = Math.floor(i / S) / S;
    const val = 236 + (n(u, v) - 0.5) * 10 + (f(u, v) - 0.5) * 8;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = val;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Cane / rattan webbing. Texture spans 0.12 m. */
function paintCane(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = "#3b2a1c";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "#d8b98a";
  ctx.lineWidth = 6;
  const step = S / 6;
  for (let i = -6; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step + S, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * step + S, 0);
    ctx.lineTo(i * step, S);
    ctx.stroke();
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#e4c89b";
  for (let i = 0; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(S, i * step);
    ctx.stroke();
  }
  return c;
}

/** A rug as a whole (UV 0..1 over the rug). */
function paintRug(variant: string, colors: [string, string, string], seed = 1): HTMLCanvasElement {
  const S = 1024;
  const [c, ctx] = canvas(S);
  const [base, ink, light] = colors;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  if (variant === "patterned") {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 18;
    ctx.strokeRect(40, 40, S - 80, S - 80);
    ctx.lineWidth = 6;
    ctx.strokeRect(80, 80, S - 160, S - 160);
    ctx.strokeStyle = light;
    ctx.lineWidth = 8;
    const step = 110;
    ctx.save();
    ctx.beginPath();
    ctx.rect(100, 100, S - 200, S - 200);
    ctx.clip();
    for (let y = 0; y < S + step; y += step) {
      for (let x = 0; x < S + step; x += step) {
        const ox = (y / step) % 2 ? step / 2 : 0;
        ctx.beginPath();
        ctx.moveTo(x + ox, y - step / 2);
        ctx.lineTo(x + ox + step / 2, y);
        ctx.lineTo(x + ox, y + step / 2);
        ctx.lineTo(x + ox - step / 2, y);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  } else if (variant === "round") {
    ctx.strokeStyle = ink;
    for (let r = 470; r > 60; r -= 90) {
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Wool texture.
  const img = ctx.getImageData(0, 0, S, S);
  const n = makeNoise(256, seed);
  const m = makeNoise(16, seed + 1);
  for (let i = 0; i < S * S; i++) {
    const u = (i % S) / S;
    const v = Math.floor(i / S) / S;
    const k = 1 + (n(u, v) - 0.5) * 0.22 + (m(u, v) - 0.5) * 0.1;
    img.data[i * 4] *= k;
    img.data[i * 4 + 1] *= k;
    img.data[i * 4 + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** An abstract canvas painting in the room's palette. */
function paintArt(colors: string[], seed: number): HTMLCanvasElement {
  const W = 768;
  const H = 540;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  ctx.fillStyle = "#efe9de";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.55 + r() * 0.4;
    ctx.beginPath();
    const x = r() * W;
    const y = r() * H;
    const rad = 60 + r() * 200;
    if (i % 3 === 0) ctx.arc(x, y, rad, 0, Math.PI * 2);
    else ctx.ellipse(x, y, rad, rad * (0.3 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#2b2622";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(r() * W, 0);
  ctx.bezierCurveTo(r() * W, H * 0.3, r() * W, H * 0.7, r() * W, H);
  ctx.stroke();
  ctx.globalAlpha = 1;
  return c;
}

/** What you see through a window: bright sky over soft greenery (it reads as daylight). */
function paintExterior(): HTMLCanvasElement {
  const W = 512;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#dfeefb");
  g.addColorStop(0.55, "#f4f8fb");
  g.addColorStop(0.62, "#c9d8bf");
  g.addColorStop(1, "#9fb58f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = rng(4);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${110 + r() * 40},${140 + r() * 40},${100 + r() * 30},0.5)`;
    ctx.beginPath();
    ctx.arc(r() * W, H * (0.55 + r() * 0.1), 20 + r() * 50, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// ---------------------------------------------------------------------------
// Material library

export interface MaterialOptions {
  style: StyleId;
  /** White clay everywhere (a Blender-style model check). */
  clay?: boolean;
}

/**
 * Cached materials for one room build. Ask by intent — `wood("walnut")`,
 * `fabric("#cdbfa8")`, `stone("white-marble")` — and get one shared material.
 */
export class Materials {
  readonly THREE: ThreeNS;
  readonly palette: Palette;
  readonly clay: boolean;
  private cache = new Map<string, Mat>();
  private textures: Tex[] = [];

  constructor(THREE: ThreeNS, opts: MaterialOptions) {
    this.THREE = THREE;
    this.palette = STYLES[opts.style] ?? STYLES["modern-warm"];
    this.clay = Boolean(opts.clay);
  }

  private memo<T extends Mat>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) {
      m = this.clay && !key.startsWith("emissive") && !key.startsWith("glass") && !key.startsWith("exterior") ? (this.clayMat(key) as unknown as T) : make();
      m.name = key;
      this.cache.set(key, m);
    }
    return m;
  }

  private clayMat(key: string): Mat {
    const tint = key.startsWith("floor") ? 0xd9d6d0 : key.startsWith("wall") ? 0xf2f0ec : 0xe8e5df;
    return new this.THREE.MeshStandardMaterial({ color: tint, roughness: 0.85 });
  }

  /** A canvas texture tiled in metres (`span` = metres one copy covers). */
  private tex(c: HTMLCanvasElement, span: number, color = true): Tex {
    const t = new this.THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = this.THREE.RepeatWrapping;
    t.repeat.set(1 / span, 1 / span);
    t.anisotropy = 8;
    if (color) t.colorSpace = this.THREE.SRGBColorSpace;
    this.textures.push(t);
    return t;
  }

  private canvases = new Map<string, HTMLCanvasElement>();
  private canvasFor(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let c = this.canvases.get(key);
    if (!c) {
      c = make();
      this.canvases.set(key, c);
    }
    return c;
  }

  wood(species: WoodSpecies = this.palette.wood, gloss = false): Mat {
    return this.memo(`wood:${species}:${gloss}`, () => {
      const c = this.canvasFor(`wood:${species}`, () => paintWood(species));
      return new this.THREE.MeshStandardMaterial({
        map: this.tex(c, 0.6),
        bumpMap: this.tex(c, 0.6, false),
        bumpScale: 0.6,
        roughness: gloss ? 0.32 : 0.58,
      });
    });
  }

  fabric(color: string = this.palette.fabric, kind: "linen" | "velvet" | "boucle" = "linen"): Mat {
    return this.memo(`fabric:${color}:${kind}`, () => {
      const c = this.canvasFor("fabric", () => paintFabric());
      const span = kind === "boucle" ? 0.12 : 0.25;
      if (kind === "velvet") {
        return new this.THREE.MeshPhysicalMaterial({
          color,
          map: this.tex(c, span),
          roughness: 0.75,
          sheen: 1,
          sheenRoughness: 0.4,
          sheenColor: new this.THREE.Color(color).lerp(new this.THREE.Color("#ffffff"), 0.35),
        });
      }
      return new this.THREE.MeshStandardMaterial({
        color,
        map: this.tex(c, span),
        bumpMap: this.tex(c, span, false),
        bumpScale: kind === "boucle" ? 2.5 : 1.2,
        roughness: 0.95,
      });
    });
  }

  leather(color: string = this.palette.leather): Mat {
    return this.memo(`leather:${color}`, () => new this.THREE.MeshStandardMaterial({ color, roughness: 0.48 }));
  }

  lacquer(color: string = this.palette.lacquer, matte = false): Mat {
    return this.memo(`lacquer:${color}:${matte}`, () =>
      new this.THREE.MeshPhysicalMaterial({ color, roughness: matte ? 0.55 : 0.28, clearcoat: matte ? 0 : 0.6, clearcoatRoughness: 0.25 }),
    );
  }

  wallPaint(color: string): Mat {
    return this.memo(`wall:${color}`, () => {
      const c = this.canvasFor("wallnoise", () => paintWallNoise());
      return new this.THREE.MeshStandardMaterial({ color, roughness: 0.92, bumpMap: this.tex(c, 1, false), bumpScale: 0.15 });
    });
  }

  metal(kind: MetalKind = this.palette.metal): Mat {
    const spec: Record<MetalKind, [number, number, number]> = {
      brass: [0xc6a15b, 1, 0.32],
      gold: [0xd4af6a, 1, 0.25],
      black: [0x232323, 0.5, 0.45],
      steel: [0xc4c6c8, 1, 0.3],
    };
    const [color, metalness, roughness] = spec[kind];
    return this.memo(`metal:${kind}`, () => new this.THREE.MeshStandardMaterial({ color, metalness, roughness }));
  }

  stone(kind: StoneKind = this.palette.stone): Mat {
    return this.memo(`stone:${kind}`, () => {
      const c = this.canvasFor(`marble:${kind}`, () => paintMarble(kind));
      return new this.THREE.MeshPhysicalMaterial({ map: this.tex(c, 1.2), roughness: 0.18, clearcoat: 0.4 });
    });
  }

  ceramic(color = "#f7f7f5"): Mat {
    return this.memo(`ceramic:${color}`, () => new this.THREE.MeshPhysicalMaterial({ color, roughness: 0.12, clearcoat: 0.8 }));
  }

  cane(): Mat {
    return this.memo("cane", () => {
      const c = this.canvasFor("cane", () => paintCane());
      return new this.THREE.MeshStandardMaterial({ map: this.tex(c, 0.12), roughness: 0.7 });
    });
  }

  glass(tint = "#e9f1f3", opacity = 0.18): Mat {
    return this.memo(`glass:${tint}:${opacity}`, () =>
      new this.THREE.MeshPhysicalMaterial({
        color: tint,
        roughness: 0.04,
        metalness: 0,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
  }

  /** Reeded / fluted glass: translucent, frosted. */
  frosted(): Mat {
    return this.memo("glass:frosted", () =>
      new this.THREE.MeshPhysicalMaterial({ color: "#e6ece9", roughness: 0.35, transparent: true, opacity: 0.55, depthWrite: false }),
    );
  }

  mirror(): Mat {
    return this.memo("mirror", () => new this.THREE.MeshStandardMaterial({ color: 0xf2f4f5, metalness: 1, roughness: 0.03 }));
  }

  /** A light source surface (lamp shade, LED strip, screen glow). */
  emissive(color = "#fff1d6", intensity = 1.6): Mat {
    return this.memo(`emissive:${color}:${intensity}`, () =>
      new this.THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 1 }),
    );
  }

  /** A lamp shade: lit from inside. */
  shade(color = "#f3e9d8"): Mat {
    return this.memo(`emissive:shade:${color}`, () =>
      new this.THREE.MeshStandardMaterial({ color, emissive: "#ffd9a0", emissiveIntensity: 0.55, roughness: 0.9, side: this.THREE.DoubleSide }),
    );
  }

  screen(): Mat {
    return this.memo("screen", () => new this.THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, roughness: 0.08, clearcoat: 1 }));
  }

  floor(kind: FloorFinish): Mat {
    return this.memo(`floor:${kind}`, () => {
      if (kind === "wood") {
        const c = this.canvasFor(`planks:${this.palette.woodAccent}`, () => paintPlanks(this.palette.woodAccent === "wenge" ? "walnut" : this.palette.woodAccent));
        return new this.THREE.MeshStandardMaterial({ map: this.tex(c, 2.4), bumpMap: this.tex(c, 2.4, false), bumpScale: 0.4, roughness: 0.45 });
      }
      if (kind === "tile") {
        const kindStone = this.palette.stone === "black-marble" ? "white-marble" : this.palette.stone;
        const c = this.canvasFor(`tiles:${kindStone}`, () => paintTiles(kindStone));
        return new this.THREE.MeshPhysicalMaterial({ map: this.tex(c, 1.2), roughness: 0.22, clearcoat: 0.3 });
      }
      if (kind === "marble") {
        const c = this.canvasFor(`marble:floor`, () => paintMarble("white-marble", 31));
        return new this.THREE.MeshPhysicalMaterial({ map: this.tex(c, 1.6), roughness: 0.12, clearcoat: 0.6 });
      }
      const c = this.canvasFor("fabric", () => paintFabric());
      return new this.THREE.MeshStandardMaterial({ color: "#b9ab98", map: this.tex(c, 0.15), roughness: 1 });
    });
  }

  rug(variant: string, colors: [string, string, string] = this.palette.rug): Mat {
    return this.memo(`rug:${variant}:${colors.join()}`, () => {
      const c = this.canvasFor(`rug:${variant}:${colors.join()}`, () => paintRug(variant, colors));
      const t = new this.THREE.CanvasTexture(c);
      t.colorSpace = this.THREE.SRGBColorSpace;
      t.anisotropy = 8;
      this.textures.push(t);
      return new this.THREE.MeshStandardMaterial({ map: t, roughness: 1, bumpMap: t, bumpScale: 1 });
    });
  }

  art(seed: number): Mat {
    return this.memo(`art:${seed}`, () => {
      const p = this.palette;
      const c = this.canvasFor(`art:${seed}`, () => paintArt([p.accent, p.accent2, p.fabric, p.rug[1]], seed));
      const t = new this.THREE.CanvasTexture(c);
      t.colorSpace = this.THREE.SRGBColorSpace;
      this.textures.push(t);
      return new this.THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
    });
  }

  exterior(): Mat {
    return this.memo("exterior", () => {
      const t = new this.THREE.CanvasTexture(paintExterior());
      t.colorSpace = this.THREE.SRGBColorSpace;
      this.textures.push(t);
      return new this.THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new this.THREE.Color(1.6, 1.6, 1.6) });
    });
  }

  leaf(): Mat {
    return this.memo("leaf", () => new this.THREE.MeshStandardMaterial({ color: "#4f6f3a", roughness: 0.6, side: this.THREE.DoubleSide }));
  }

  /** Main material for a catalog role, honouring a finish word if given. */
  byRole(role: string, finish?: string): Mat {
    const f = resolveFinish(finish);
    if (f?.kind === "wood") return this.wood(f.species);
    if (f?.kind === "stone") return this.stone(f.stone);
    if (f?.kind === "cane") return this.cane();
    if (f?.kind === "leather") return this.leather(f.color ?? this.palette.leather);
    if (f?.kind === "velvet") return this.fabric(f.color ?? this.palette.fabric, "velvet");
    if (f?.kind === "glass") return this.frosted();
    if (f?.kind === "metal") return this.metal(f.metal);
    if (f?.kind === "color") {
      if (role === "fabric") return this.fabric(f.color);
      return this.lacquer(f.color, true);
    }
    switch (role) {
      case "fabric":
        return this.fabric();
      case "lacquer":
        return this.lacquer();
      case "stone":
        return this.stone();
      case "metal":
        return this.metal();
      case "ceramic":
        return this.ceramic();
      default:
        return this.wood();
    }
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    this.cache.clear();
    this.textures = [];
  }
}

// ---------------------------------------------------------------------------
// Finish words → material intent (also used by commands to validate a finish).

export type Finish =
  | { kind: "wood"; species: WoodSpecies }
  | { kind: "stone"; stone: StoneKind }
  | { kind: "color"; color: string }
  | { kind: "velvet"; color?: string }
  | { kind: "leather"; color?: string }
  | { kind: "metal"; metal: MetalKind }
  | { kind: "cane" }
  | { kind: "glass" };

/** Read a finish word/phrase ("walnut", "sage green velvet", "white marble", "#aabbcc"). */
export function resolveFinish(finish?: string): Finish | null {
  if (!finish) return null;
  const f = finish.toLowerCase().trim();
  if (/^#[0-9a-f]{6}$/.test(f)) return { kind: "color", color: f };
  const color = longestKey(COLOR_WORDS, f);
  if (/\bvelvet\b/.test(f)) return { kind: "velvet", color: color ? COLOR_WORDS[color] : undefined };
  if (/\bleather\b/.test(f)) return { kind: "leather", color: color ? COLOR_WORDS[color] : undefined };
  if (/\b(cane|rattan|wicker)\b/.test(f)) return { kind: "cane" };
  if (/\b(glass|fluted glass)\b/.test(f)) return { kind: "glass" };
  if (/\bmarble|granite|stone\b/.test(f)) {
    const stone: StoneKind = /black/.test(f) ? "black-marble" : /grey|gray/.test(f) ? "grey-marble" : /beige|cream/.test(f) ? "beige-marble" : "white-marble";
    return { kind: "stone", stone };
  }
  if (/\b(brass|gold|golden)\b/.test(f)) return { kind: "metal", metal: /gold/.test(f) ? "gold" : "brass" };
  if (/\b(steel|chrome|silver)\b/.test(f)) return { kind: "metal", metal: "steel" };
  const wood = longestKey(WOOD_WORDS, f);
  if (wood && !color) return { kind: "wood", species: WOOD_WORDS[wood] };
  if (color) return { kind: "color", color: COLOR_WORDS[color] };
  if (wood) return { kind: "wood", species: WOOD_WORDS[wood] };
  return null;
}

function longestKey(dict: Record<string, unknown>, text: string): string | null {
  let best: string | null = null;
  for (const k of Object.keys(dict)) {
    if (new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`).test(text) && (!best || k.length > best.length)) best = k;
  }
  return best;
}
