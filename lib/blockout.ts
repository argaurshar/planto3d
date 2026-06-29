// Client-only: build a coarse eye-level 3D "blockout" of a room from the Gemini
// spatial boxes, rendered to a PNG data URL. This image is fed to the renderer as
// an image-to-image control: it fixes the CAMERA VIEWPOINT and the wall / window /
// door / furniture POSITIONS so the photoreal render can't rearrange the layout
// (text prompts only ever soft-guide layout). `three` is imported dynamically so
// it is code-split out of the main/SSR bundle — call this only in the browser.

import {
  furnitureHeight,
  isOpeningLabel,
  nearestWall,
  type SpatialBox,
} from "./spatial";

const WALL_H = 2.7; // ceiling height (m)
const ROOM_MAX = 6; // longest floor dimension (m)
const EYE_H = 1.5; // camera height (m)

export interface BlockoutOptions {
  width?: number; // output px
  height?: number; // output px
}

/**
 * Render the boxes as a simple massing model from a doorway eye-level camera.
 * Returns a PNG data URL, or null if there is nothing to build or WebGL is
 * unavailable (callers then fall back to text-to-image).
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
    renderer.setClearColor(0xf4f1ec, 1);

    const scene = new THREE.Scene();

    // 0-1000 (top = far, i.e. Z=0) → metres.
    const toX = (v: number) => (v / 1000) * roomW;
    const toZ = (v: number) => (v / 1000) * roomD;

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xded6ca,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xb9ad99, roughness: 1 });
    const furnMat = new THREE.MeshStandardMaterial({ color: 0x9b9183, roughness: 0.9 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xbfe0ef,
      emissive: 0x9fd0e6,
      emissiveIntensity: 0.6,
      roughness: 0.4,
    });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6f5a44, roughness: 0.9 });

    // Floor.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(roomW / 2, 0, roomD / 2);
    scene.add(floor);

    // Walls (far, left, right, near). Near wall kept so the box reads as enclosed.
    const addWall = (w: number, x: number, z: number, rotY: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), wallMat);
      m.position.set(x, WALL_H / 2, z);
      m.rotation.y = rotY;
      scene.add(m);
    };
    addWall(roomW, roomW / 2, 0, 0); // far
    addWall(roomD, 0, roomD / 2, Math.PI / 2); // left
    addWall(roomD, roomW, roomD / 2, Math.PI / 2); // right

    // Furniture + openings.
    for (const b of boxes) {
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      const cx = toX((xmin + xmax) / 2);
      const cz = toZ((ymin + ymax) / 2);
      const bw = Math.max(0.2, toX(Math.abs(xmax - xmin)));
      const bd = Math.max(0.2, toZ(Math.abs(ymax - ymin)));

      if (isOpeningLabel(b.label)) {
        const wall = nearestWall((xmin + xmax) / 2, (ymin + ymax) / 2);
        const isDoor = /\b(door|doorway|entry)\b/.test(b.label.toLowerCase());
        const mat = isDoor ? doorMat : windowMat;
        const h = isDoor ? 2.0 : 1.3;
        const y = isDoor ? h / 2 : 1.2; // windows sit higher
        const span = wall === "far" || wall === "near" ? bw : bd;
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.5, span), h), mat);
        const eps = 0.02;
        if (wall === "far") panel.position.set(cx, y, eps);
        else if (wall === "near") {
          panel.position.set(cx, y, roomD - eps);
          panel.rotation.y = Math.PI;
        } else if (wall === "left") {
          panel.position.set(eps, y, cz);
          panel.rotation.y = Math.PI / 2;
        } else {
          panel.position.set(roomW - eps, y, cz);
          panel.rotation.y = -Math.PI / 2;
        }
        scene.add(panel);
        continue;
      }

      const h = furnitureHeight(b.label);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd), furnMat);
      mesh.position.set(cx, h / 2, cz);
      scene.add(mesh);
    }

    // Lighting.
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(roomW * 0.7, WALL_H * 1.5, roomD * 0.9);
    scene.add(key);

    // Eye-level "doorway" camera: stand at the near wall, look at the far wall.
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 100);
    camera.position.set(roomW / 2, EYE_H, roomD - 0.2);
    camera.lookAt(roomW / 2, 1.2, 0);

    renderer.render(scene, camera);
    const url = canvas.toDataURL("image/png");

    // Free GPU resources.
    [wallMat, floorMat, furnMat, windowMat, doorMat].forEach((m) => m.dispose());
    scene.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    renderer.dispose();
    return url;
  } catch {
    try {
      renderer.dispose();
    } catch {
      /* ignore */
    }
    return null;
  }
}
