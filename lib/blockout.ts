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
  boxCenter,
  cameraSpot,
  type CameraSpot,
  furnitureCategory,
  furnitureHeight,
  isDoorLabel,
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
// How far outside its wall the eye sits. Standing inside a small room puts the
// viewer on top of the furniture; backing out gives normal interior framing.
// The floor, ceiling and flanking walls are extended by the same amount so the
// view stays bounded by real surfaces instead of leaking to the background.
const VIEW_OUT = 1.8;

// Palette: a MATTE CLAY MASSING MODEL, not a neon segmentation map.
//
// Kontext is structure-preserving, and it preserves COLOUR as part of that
// structure: with the old saturated legend (bed = blue, storage = orange,
// "other" = purple) those hues came straight back out of the renderer as a teal
// panel over the bed, an orange wardrobe and a purple bench. So every tone here
// is a plausible real interior material, kept distinct enough in hue AND value
// to still identify the object type. Colour carry-over is now harmless — the
// blockout already looks like a sane room.
const COLORS = {
  floor: 0xbdb5a8, // light greige stone
  wall: 0xeceae5, // soft warm white
  window: 0xdaeefc, // daylight (kept bright; it should read as light)
  door: 0x8a6a4a, // mid wood
  ceiling: 0xf3f1ed, // slightly brighter than the walls
} as const;

/** Muted material tone per furniture category — the blockout's legend. */
const CATEGORY_COLOR: Record<FurnitureCategory, number> = {
  bed: 0xe8dfd0, // linen cream
  seating: 0x8e9c8f, // sage upholstery
  storage: 0x7c6046, // dark walnut
  table: 0xb08a5e, // light wood
  bath: 0xcfdde1, // porcelain blue-grey
  rug: 0xbfae8f, // sand
  other: 0xa39d95, // warm grey
};

export interface BlockoutOptions {
  width?: number; // output px
  height?: number; // output px
  /** True room size in metres (from the plan's printed dimensions), if known. */
  roomSize?: RoomSize | null;
}

type Vec3 = [number, number, number];

/**
 * Floor footprint in metres. Prefers the plan's printed dimensions so furniture
 * reads at true proportion; falls back to the crop aspect at an assumed size.
 * If the printed dimensions are rotated relative to how the room is drawn (the
 * model swapped the axes), they are swapped back to match the crop: the crop is
 * wider than tall exactly when width should exceed depth.
 */
function footprint(aspect: number, roomSize?: RoomSize | null): { roomW: number; roomD: number } {
  if (roomSize) {
    const { width, depth } = roomSize;
    const swapped = aspect >= 1 !== width >= depth;
    return swapped ? { roomW: depth, roomD: width } : { roomW: width, roomD: depth };
  }
  return {
    roomW: aspect >= 1 ? ROOM_MAX : ROOM_MAX * aspect,
    roomD: aspect >= 1 ? ROOM_MAX / aspect : ROOM_MAX,
  };
}

/**
 * Where the viewer stands, in metres. The wall and position come from
 * lib/spatial.ts `cameraSpot` — the SAME function the layout text uses — so the
 * blockout, the prompt writer and the verifier always share one viewpoint
 * (door preferred, clamped away from corners, never inside furniture).
 */
function cameraPlacement(
  spot: CameraSpot,
  roomW: number,
  roomD: number,
): { pos: Vec3; target: Vec3 } {
  // The eye sits OUTSIDE its wall (which the caller culls), the standard cutaway
  // interior shot. Standing inside a small room put the viewer on top of the
  // furniture: in a 3.4x3.0m bedroom a 0.35m inset left a 2m wardrobe filling a
  // third of the frame.
  const OUT = VIEW_OUT;
  const LOOK_H = 1.15; // look-at height (m)
  const { wall, along } = spot;
  const x = (along / 1000) * roomW;
  const z = (along / 1000) * roomD;
  // Aim past the centre so the wall the viewer faces sits mid-frame.
  const table: Record<Wall, { pos: Vec3; target: Vec3 }> = {
    far: { pos: [x, EYE_H, -OUT], target: [roomW / 2, LOOK_H, roomD * 0.65] },
    near: { pos: [x, EYE_H, roomD + OUT], target: [roomW / 2, LOOK_H, roomD * 0.35] },
    left: { pos: [-OUT, EYE_H, z], target: [roomW * 0.65, LOOK_H, roomD / 2] },
    right: { pos: [roomW + OUT, EYE_H, z], target: [roomW * 0.35, LOOK_H, roomD / 2] },
  };
  return table[wall];
}

/**
 * Render the boxes as a colour-coded massing model from an eye-level camera
 * standing in the doorway (see `cameraSpot`). Returns a PNG data URL, or null if there is
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
  // One viewpoint, shared by the wall culling and the camera (and, via
  // describeLayout, by the prompt writer and the verifier).
  const spot = cameraSpot(boxes);

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
    renderer.setClearColor(0xd9d6d0, 1);

    const scene = new THREE.Scene();
    // Lambert + soft light gives the massing real shading, so the image Kontext
    // receives already has believable form and falloff instead of reading as a
    // flat CG poster. The window stays unlit so it glows like daylight.
    const clay = (color: number) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const flat = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    // The ground half must stay light: the ceiling's normal faces down, so a dark
    // ground colour painted it a dim blue-grey instead of a bright ceiling.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd7d2ca, 2.0));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.5);
    sun.position.set(roomW * 0.8, 3.2, roomD * 0.15);
    scene.add(sun);

    // 0-1000 (top = far, i.e. Z=0) → metres.
    const toX = (v: number) => (v / 1000) * roomW;
    const toZ = (v: number) => (v / 1000) * roomD;

    // The shell is stretched by VIEW_OUT on the camera's side so the floor,
    // ceiling and flanking walls still fill the frame from outside the room.
    let xMin = 0;
    let xMax = roomW;
    let zMin = 0;
    let zMax = roomD;
    if (spot.wall === "near") zMax += VIEW_OUT;
    else if (spot.wall === "far") zMin -= VIEW_OUT;
    else if (spot.wall === "left") xMin -= VIEW_OUT;
    else xMax += VIEW_OUT;
    const shellW = xMax - xMin;
    const shellD = zMax - zMin;
    const midX = (xMin + xMax) / 2;
    const midZ = (zMin + zMax) / 2;

    // Floor + ceiling. The ceiling matters: without one the top of the frame was
    // open background, which reads as an unfinished 3D scene rather than a room.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(shellW, shellD), clay(COLORS.floor));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(midX, 0, midZ);
    scene.add(floor);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(shellW, shellD), clay(COLORS.ceiling));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(midX, WALL_H, midZ);
    scene.add(ceiling);

    // Every wall except the one the camera stands outside of — that one would
    // sit between the eye and the room and block the whole view.
    const wallMat = clay(COLORS.wall);
    const addWall = (w: number, x: number, z: number, rotY: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, WALL_H), wallMat);
      m.position.set(x, WALL_H / 2, z);
      m.rotation.y = rotY;
      scene.add(m);
    };
    if (spot.wall !== "far") addWall(shellW, midX, 0, 0);
    if (spot.wall !== "near") addWall(shellW, midX, roomD, 0);
    if (spot.wall !== "left") addWall(shellD, 0, midZ, Math.PI / 2);
    if (spot.wall !== "right") addWall(shellD, roomW, midZ, Math.PI / 2);

    // Furniture + openings, colour-coded by category.
    for (const b of boxes) {
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      const cx = toX((xmin + xmax) / 2);
      const cz = toZ((ymin + ymax) / 2);
      const bw = Math.max(0.2, toX(Math.abs(xmax - xmin)));
      const bd = Math.max(0.2, toZ(Math.abs(ymax - ymin)));

      if (isOpeningLabel(b.label)) {
        const c = boxCenter(b);
        const wall = nearestWall(c.cx, c.cy);
        const isDoor = isDoorLabel(b.label);
        // Doors are clay; a window should read as a bright light source.
        const mat = isDoor ? clay(COLORS.door) : flat(COLORS.window);
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
        clay(CATEGORY_COLOR[furnitureCategory(b.label)]),
      );
      mesh.position.set(cx, h / 2, cz);
      scene.add(mesh);
    }

    // Eye-level camera standing at the doorway looking into the room, so every
    // wall the room is "read" against — including the one the bed sits on and
    // the one carrying the window — is in frame.
    const { pos, target } = cameraPlacement(spot, roomW, roomD);
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
