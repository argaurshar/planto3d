// Client-only: build a coarse eye-level 3D "blockout" of a room from the Gemini
// spatial boxes, rendered to a PNG data URL. This image is fed to the renderer as
// an image-to-image control: it fixes the CAMERA VIEWPOINT and the wall / window /
// door / furniture POSITIONS so the photoreal render can't rearrange the layout.
//
// It is a matte CLAY MASSING MODEL: lit surfaces in muted real-material tones
// (see COLORS / CATEGORY_COLOR below for why not a neon legend). `three` is
// imported dynamically so it is code-split out of the main/SSR bundle — browser
// only.

import {
  boxCenter,
  cameraSpot,
  type CameraSpot,
  furnitureCategory,
  furnitureHeight,
  isBehindViewer,
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
  floor: 0xa8a094, // mid warm grey stone — every piece must read against it
  wall: 0xeceae5, // soft warm white
  window: 0xdaeefc, // daylight (kept bright; it should read as light)
  door: 0x8a6a4a, // mid wood
  ceiling: 0xf3f1ed, // slightly brighter than the walls
  edge: 0x3a332c, // outline drawn round every block
} as const;

/**
 * Material tone per furniture category — the blockout's legend. Real-material
 * hues (so colour carry-over into the render is harmless) but every one is
 * a MID tone, clearly darker than the walls and distinct from the floor: the
 * first clay palette used a linen-cream bed and a sand rug that all but
 * vanished against the off-white walls and greige floor, and with no
 * structure left to preserve Kontext re-imagined the whole layout.
 */
const CATEGORY_COLOR: Record<FurnitureCategory, number> = {
  bed: 0xc8b48e, // oat linen
  seating: 0x6e7f70, // deep sage upholstery
  storage: 0x5e4632, // dark walnut
  table: 0xa6784a, // mid oak
  bath: 0xb9ccd3, // porcelain blue-grey
  rug: 0x9d8760, // tan
  other: 0x857c72, // warm mid grey
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
  return (await buildBlockoutMaps(boxes, cropAspect, opts))?.clay ?? null;
}

export interface BlockoutMaps {
  /** The clay massing (outlined blocks, cast shadows) — what the UI shows and the verifier sees. */
  clay: string;
  /** Linear depth of the same view (white = near, black = far) for the reference engine. */
  depth: string;
}

/**
 * Same scene, two passes: the clay massing and a depth map from the identical
 * camera. The depth map is the pixel-aligned structural signal an image model
 * can't misread — the geometry is already ours, so it costs one extra draw.
 */
export async function buildBlockoutMaps(
  boxes: SpatialBox[],
  cropAspect: number,
  opts: BlockoutOptions = {},
): Promise<BlockoutMaps | null> {
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
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd7d2ca, 1.1));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    // The sun casts real shadows: contact shadows are what separate a block
    // from the floor for the edit model, so it keeps the object where it is
    // instead of dissolving it into the surface.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
    sun.position.set(roomW * 0.9, 3.6, roomD * 0.1);
    sun.target.position.set(roomW / 2, 0, roomD / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    const reach = Math.max(roomW, roomD) + VIEW_OUT + 1;
    sun.shadow.camera.left = -reach;
    sun.shadow.camera.right = reach;
    sun.shadow.camera.top = reach;
    sun.shadow.camera.bottom = -reach;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = reach * 3;
    scene.add(sun);
    scene.add(sun.target);
    // Every block gets a dark outline. Colour alone proved too weak a
    // structural signal; explicit edges are what Kontext preserves most
    // faithfully, whatever the tones become.
    const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.edge });
    const outline = (mesh: import("three").Mesh) => {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
      lines.position.copy(mesh.position);
      lines.rotation.copy(mesh.rotation);
      scene.add(lines);
    };

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
    floor.receiveShadow = true;
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
      m.receiveShadow = true;
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
        // An opening on the wall the camera stands outside of is behind the
        // viewer. Its wall is culled, but the panel used to be drawn anyway —
        // a 2m door slab 1.8m in front of the lens, eating a third of the frame.
        // (Same predicate the layout text uses to mark it "not visible".)
        if (isBehindViewer(spot, wall)) continue;
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
        outline(panel);
        continue;
      }

      const h = furnitureHeight(b.label);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(bw, h, bd),
        clay(CATEGORY_COLOR[furnitureCategory(b.label)]),
      );
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      outline(mesh);
    }

    // Eye-level camera standing at the doorway looking into the room, so every
    // wall the room is "read" against — including the one the bed sits on and
    // the one carrying the window — is in frame.
    const { pos, target } = cameraPlacement(spot, roomW, roomD);
    const camera = new THREE.PerspectiveCamera(72, width / height, 0.05, 100);
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(target[0], target[1], target[2]);

    renderer.render(scene, camera);
    const clayUrl = canvas.toDataURL("image/png");

    // Depth pass: linear view-space depth over the room's own range, so a
    // 4m room uses the full grey ramp instead of the last 2% of a
    // perspective z-buffer.
    const farDist = Math.hypot(shellW, shellD, WALL_H) + VIEW_OUT;
    const depthMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, // the shell planes face whichever way; never cull one
      uniforms: { near: { value: 0.3 }, far: { value: farDist } },
      vertexShader:
        "varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }",
      fragmentShader:
        "uniform float near; uniform float far; varying float vZ; void main(){ float d = clamp((vZ - near) / (far - near), 0.0, 1.0); gl_FragColor = vec4(vec3(1.0 - d), 1.0); }",
    });
    scene.overrideMaterial = depthMat;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 1);
    renderer.render(scene, camera);
    const depth = canvas.toDataURL("image/png");
    scene.overrideMaterial = null;
    depthMat.dispose();

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
    return { clay: clayUrl, depth };
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
