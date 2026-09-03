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
  type RoomSize,
  type SpatialBox,
  type Wall,
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
  /** True room size in metres (from the plan's printed dimensions), if known. */
  roomSize?: RoomSize | null;
}

const DOOR_RE = /\b(door|doorway|entry)\b/;

/**
 * Floor footprint in metres. Prefers the plan's printed dimensions so furniture
 * reads at true proportion; falls back to the crop aspect at an assumed size.
 * If the printed dimensions are rotated relative to how the room is drawn (the
 * model swapped the axes), they are swapped back to match the crop.
 */
function footprint(aspect: number, roomSize?: RoomSize | null): { roomW: number; roomD: number } {
  if (roomSize) {
    const { width, depth } = roomSize;
    // Pick the orientation that better matches the crop's own aspect ratio.
    const swapped = Math.abs(aspect - depth / width) < Math.abs(aspect - width / depth);
    return swapped ? { roomW: depth, roomD: width } : { roomW: width, roomD: depth };
  }
  return {
    roomW: aspect >= 1 ? ROOM_MAX : ROOM_MAX * aspect,
    roomD: aspect >= 1 ? ROOM_MAX / aspect : ROOM_MAX,
  };
}

/**
 * Where the viewer stands. Preferring the detected door gives the natural
 * "standing in the doorway" interior shot AND guarantees the camera is not
 * inside the room's furniture. Without a door, stand at the middle of the
 * emptiest wall so the most content is in frame.
 */
function cameraPlacement(
  boxes: SpatialBox[],
  roomW: number,
  roomD: number,
): { pos: [number, number, number]; target: [number, number, number] } {
  const toX = (v: number) => (v / 1000) * roomW;
  const toZ = (v: number) => (v / 1000) * roomD;
  const INSET = 0.35; // stand just inside the wall, not embedded in it

  const place = (wall: Wall, cx: number, cz: number) => {
    switch (wall) {
      case "far":
        return { pos: [cx, EYE_H, INSET] as [number, number, number], target: [roomW / 2, 1.0, roomD] as [number, number, number] };
      case "near":
        return { pos: [cx, EYE_H, roomD - INSET] as [number, number, number], target: [roomW / 2, 1.0, 0] as [number, number, number] };
      case "left":
        return { pos: [INSET, EYE_H, cz] as [number, number, number], target: [roomW, 1.0, roomD / 2] as [number, number, number] };
      default:
        return { pos: [roomW - INSET, EYE_H, cz] as [number, number, number], target: [0, 1.0, roomD / 2] as [number, number, number] };
    }
  };

  const door = boxes.find((b) => DOOR_RE.test(b.label.toLowerCase()));
  if (door) {
    const [ymin, xmin, ymax, xmax] = door.box_2d;
    const mx = (xmin + xmax) / 2;
    const my = (ymin + ymax) / 2;
    return place(nearestWall(mx, my), toX(mx), toZ(my));
  }

  // No door detected: stand at the wall with the fewest items against it.
  const counts: Record<Wall, number> = { far: 0, near: 0, left: 0, right: 0 };
  for (const b of boxes) {
    const [ymin, xmin, ymax, xmax] = b.box_2d;
    counts[nearestWall((xmin + xmax) / 2, (ymin + ymax) / 2)] += 1;
  }
  const emptiest = (Object.keys(counts) as Wall[]).reduce((a, b) =>
    counts[b] < counts[a] ? b : a,
  );
  return place(emptiest, roomW / 2, roomD / 2);
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

  const aspect = Number.isFinite(cropAspect) && cropAspect > 0 ? cropAspect : 1;
  const { roomW, roomD } = footprint(aspect, opts.roomSize);

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

    // All four walls. The one the camera stands at falls behind the near plane
    // and is culled automatically, so nothing occludes the view — and furniture
    // placed against any wall reads as touching it instead of floating.
    const wallMat = flat(COLORS.wall);
    const addWall = (w: number, x: number, z: number, rotY: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), wallMat);
      m.position.set(x, WALL_H / 2, z);
      m.rotation.y = rotY;
      scene.add(m);
    };
    addWall(roomW, roomW / 2, 0, 0); // far
    addWall(roomW, roomW / 2, roomD, 0); // near
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

    // Eye-level camera standing at the doorway looking into the room, so every
    // wall the room is "read" against — including the one the bed sits on and
    // the one carrying the window — is in frame.
    const { pos, target } = cameraPlacement(boxes, roomW, roomD);
    const camera = new THREE.PerspectiveCamera(72, width / height, 0.05, 100);
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(target[0], target[1], target[2]);

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
