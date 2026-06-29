// Client-only: build a coarse eye-level 3D "blockout" of a room from the Gemini
// spatial boxes, rendered to a PNG data URL. This image is fed to the renderer as
// an image-to-image control: it fixes the CAMERA VIEWPOINT and the wall / window /
// door / furniture POSITIONS so the photoreal render can't rearrange the layout.
//
// It is a SEMANTIC MASSING MAP, not a moody render: flat, high-contrast colours
// per furniture category (a hand-built segmentation map) so each item reads as a
// solid coloured region and the renderer can map colour -> furniture type (the
// colour legend is in lib/prompts.ts `roomRenderPrompt`). `three` is imported
// dynamically so it is code-split out of the main/SSR bundle — browser only.

import {
  furnitureCategory,
  furnitureHeight,
  isOpeningLabel,
  nearestWall,
  type FurnitureCategory,
  type SpatialBox,
} from "./spatial";

const WALL_H = 2.7; // ceiling height (m)
const ROOM_MAX = 6; // longest floor dimension (m)
const EYE_H = 1.5; // camera height (m)

const COLORS = {
  floor: 0x4b5563,
  wall: 0xe5e7eb,
  window: 0x38bdf8,
  door: 0x92400e,
} as const;

/** Flat colour per furniture category — the blockout's segmentation legend. */
const CATEGORY_COLOR: Record<FurnitureCategory, number> = {
  bed: 0x2563eb, // blue
  seating: 0x16a34a, // green
  storage: 0xea580c, // orange
  table: 0xca8a04, // amber/yellow
  bath: 0x0d9488, // teal
  rug: 0x94a3b8, // light slate
  other: 0x9333ea, // purple
};

export interface BlockoutOptions {
  width?: number; // output px
  height?: number; // output px
}

/**
 * Render the boxes as a colour-coded massing model from an eye-level corner
 * camera that frames the whole room. Returns a PNG data URL, or null if there is
 * nothing to build or WebGL is unavailable (callers fall back to text-to-image).
 *
 * `cropAspect` is the room crop's pixel width/height, used to keep the floor
 * footprint proportional. Boxes are Gemini's 0-1000 coords ([ymin,xmin,ymax,xmax],
 * top = far wall).
 */
export async function buildBlockoutDataUrl(
  boxes: SpatialBox[],
  cropAspect: number,
  opts: BlockoutOptions = {},
): Promise<string | null> {
  if (!boxes.length || typeof document === "undefined") return null;

  const width = opts.width ?? 768;
  const height = opts.height ?? 576;

  // Floor footprint in metres, proportional to the crop (width:depth = aspect:1).
  const aspect = Number.isFinite(cropAspect) && cropAspect > 0 ? cropAspect : 1;
  const roomW = aspect >= 1 ? ROOM_MAX : ROOM_MAX * aspect;
  const roomD = aspect >= 1 ? ROOM_MAX / aspect : ROOM_MAX;

  let THREE: typeof import("three");
  try {
    THREE = await import("three");
  } catch (e) {
    if (typeof console !== "undefined") console.debug("[voxa] blockout: three import failed", e);
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  let renderer: import("three").WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true, // required for toDataURL
    });
  } catch (e) {
    if (typeof console !== "undefined") console.debug("[voxa] blockout: no WebGL context", e);
    return null; // no WebGL context
  }

  try {
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x1f2937, 1);

    const scene = new THREE.Scene();
    const flat = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

    // 0-1000 (top = far, i.e. Z=0) → metres.
    const toX = (v: number) => (v / 1000) * roomW;
    const toZ = (v: number) => (v / 1000) * roomD;

    // Floor.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), flat(COLORS.floor));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomW / 2, 0, roomD / 2);
    scene.add(floor);

    // Walls (far, left, right) — the near wall is behind the corner camera.
    const wallMat = flat(COLORS.wall);
    const addWall = (w: number, x: number, z: number, rotY: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), wallMat);
      m.position.set(x, WALL_H / 2, z);
      m.rotation.y = rotY;
      scene.add(m);
    };
    addWall(roomW, roomW / 2, 0, 0); // far
    addWall(roomD, 0, roomD / 2, Math.PI / 2); // left
    addWall(roomD, roomW, roomD / 2, Math.PI / 2); // right

    // Furniture + openings, colour-coded by category.
    for (const b of boxes) {
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      const cx = toX((xmin + xmax) / 2);
      const cz = toZ((ymin + ymax) / 2);
      const bw = Math.max(0.2, toX(Math.abs(xmax - xmin)));
      const bd = Math.max(0.2, toZ(Math.abs(ymax - ymin)));

      if (isOpeningLabel(b.label)) {
        const wall = nearestWall((xmin + xmax) / 2, (ymin + ymax) / 2);
        const isDoor = /\b(door|doorway|entry)\b/.test(b.label.toLowerCase());
        const mat = flat(isDoor ? COLORS.door : COLORS.window);
        const h = isDoor ? 2.0 : 1.3;
        const y = isDoor ? h / 2 : 1.2;
        const span = wall === "far" || wall === "near" ? bw : bd;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.5, span), h), mat);
        const eps = 0.03;
        if (wall === "far") panel.position.set(cx, y, eps);
        else if (wall === "near") panel.position.set(cx, y, roomD - eps);
        else if (wall === "left") {
          panel.position.set(eps, y, cz);
          panel.rotation.y = Math.PI / 2;
        } else {
          panel.position.set(roomW - eps, y, cz);
          panel.rotation.y = Math.PI / 2;
        }
        scene.add(panel);
        continue;
      }

      const h = furnitureHeight(b.label);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(bw, h, bd),
        flat(CATEGORY_COLOR[furnitureCategory(b.label)]),
      );
      mesh.position.set(cx, h / 2, cz);
      scene.add(mesh);
    }

    // Eye-level corner camera that frames the whole room: stand in the near-right
    // corner, look diagonally across to the far-left, wide FOV to fit everything.
    const camera = new THREE.PerspectiveCamera(72, width / height, 0.05, 100);
    camera.position.set(roomW - 0.1, EYE_H, roomD - 0.1);
    camera.lookAt(roomW * 0.4, 0.9, roomD * 0.4);

    renderer.render(scene, camera);
    const url = canvas.toDataURL("image/png");

    // Free GPU resources.
    scene.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = (mesh as unknown as { material?: import("three").Material }).material;
      if (m && typeof (m as import("three").Material).dispose === "function") {
        (m as import("three").Material).dispose();
      }
    });
    renderer.dispose();
    return url;
  } catch (e) {
    if (typeof console !== "undefined") console.debug("[voxa] blockout: render failed", e);
    try {
      renderer.dispose();
    } catch {
      /* ignore */
    }
    return null;
  }
}
