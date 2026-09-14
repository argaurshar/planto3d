// The whole house as one Three.js clay model (browser only; `three` is passed
// in or imported dynamically so it stays code-split out of SSR).
//
// Built from lib/house.ts: a floor slab per room, every wall from the room
// boundaries (a wall shared by two rooms is built once, seen from both
// sides, with its doors and windows cut in), and the same furniture proxies
// the room render uses, so the house the user clicks a room in IS the model
// that room is rendered from. No ceilings: it is a dollhouse view.

import {
  cameraSpot,
  facingWall,
  furnitureCategory,
  furnitureHeight,
  isHelperLabel,
  isOpeningLabel,
  type CameraSpot,
} from "./spatial";
import { houseWalls, roomLocalBoxes, roomSizeOf, type HouseModel } from "./house";
import { buildFurniture, buildWall, facingRotation, type ProxyMaterials, type WallOpening, type WallSpec } from "./proxies";
import { CATEGORY_COLOR, COLORS, WALL_H, cameraPlacement } from "./blockout";

type ThreeNS = typeof import("three");
type Vec3 = [number, number, number];

const GROUND = 0x8f887d; // outside the rooms: darker than any floor
const FLOOR_SELECTED = 0xbfd9c9; // the picked room's floor, a soft green

/** One room of the assembled house, in metres. */
export interface HouseRoomGeom {
  index: number;
  label: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Where the entry camera stands for this room (room-local, from cameraSpot). */
  spot: CameraSpot;
  /** The entry camera in HOUSE coordinates (outside the door wall, as the render uses it). */
  entry: { pos: Vec3; target: Vec3 };
  /**
   * The same view from just INSIDE the room. The render culls the wall the
   * camera stands behind; the whole-house model can't (it is another room's
   * wall too), so the live preview steps through the doorway instead.
   */
  preview: { pos: Vec3; target: Vec3 };
}

export interface AssembledHouse {
  scene: import("three").Scene;
  /** Plan extents in metres. */
  width: number;
  depth: number;
  rooms: HouseRoomGeom[];
  /** Tint a room's floor as selected (or none). */
  highlight: (index: number | null) => void;
  dispose: () => void;
}

/**
 * Assemble the house: lights, ground, per-room floors (tagged with
 * `userData.roomIndex`, as are the furniture proxies, so a click maps back
 * to a room), merged walls with openings, furniture.
 */
export function assembleHouse(THREE: ThreeNS, house: HouseModel): AssembledHouse {
  const W = house.size.width;
  const D = house.size.depth;
  const toX = (u: number) => (u / 1000) * W;
  const toZ = (u: number) => (u / 1000) * D;

  const scene = new THREE.Scene();
  const clayCache = new Map<number, import("three").Material>();
  const clay = (color: number) => {
    let m = clayCache.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
      clayCache.set(color, m);
    }
    return m;
  };
  const flat = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const mats: ProxyMaterials = { clay, flat };

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd7d2ca, 1.0));
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
  sun.position.set(W * 0.9, Math.max(W, D) * 1.2 + 4, D * 0.15);
  sun.target.position.set(W / 2, 0, D / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  const reach = Math.max(W, D) + 2;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = reach * 4;
  scene.add(sun);
  scene.add(sun.target);

  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.edge });
  const outlineMarked = (root: import("three").Object3D) => {
    root.traverse((o) => {
      const m = o as import("three").Mesh;
      if (m.isMesh && m.userData.outline) {
        const threshold = m.userData.roundOutline ? 30 : 1;
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, threshold), edgeMat));
      }
    });
  };

  // Ground under everything, so corridors and the outside read as a base.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 2, D + 2), clay(GROUND));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, -0.02, D / 2);
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  // Floors.
  const floors: import("three").Mesh[] = [];
  const rooms: HouseRoomGeom[] = house.rooms.map((r, index) => {
    const [ymin, xmin, ymax, xmax] = r.box_2d;
    const x0 = toX(xmin);
    const x1 = toX(xmax);
    const z0 = toZ(ymin);
    const z1 = toZ(ymax);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.05, x1 - x0), Math.max(0.05, z1 - z0)),
      new THREE.MeshLambertMaterial({ color: COLORS.floor, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    floor.receiveShadow = true;
    floor.userData.roomIndex = index;
    floor.name = `room-${index}`;
    scene.add(floor);
    floors.push(floor);

    const local = roomLocalBoxes(house, index);
    const spot = cameraSpot(local);
    const { width, depth } = roomSizeOf(house, index);
    const p = cameraPlacement(spot, width, depth);
    const entry = {
      pos: [x0 + p.pos[0], p.pos[1], z0 + p.pos[2]] as Vec3,
      target: [x0 + p.target[0], p.target[1], z0 + p.target[2]] as Vec3,
    };
    const IN = 0.3; // metres inside the room's wall
    const preview = {
      pos: [
        spot.wall === "left" ? x0 + IN : spot.wall === "right" ? x1 - IN : entry.pos[0],
        entry.pos[1],
        spot.wall === "far" ? z0 + IN : spot.wall === "near" ? z1 - IN : entry.pos[2],
      ] as Vec3,
      target: entry.target,
    };
    return { index, label: r.label, x0, z0, x1, z1, spot, entry, preview };
  });

  // Walls: every room edge, merged where rooms share one, openings cut in.
  for (const wall of houseWalls(house)) {
    const alongX = wall.axis === "x";
    const openings: WallOpening[] = wall.openings.map((o) => {
      let start = alongX ? toX(o.start) : toZ(o.start);
      let end = alongX ? toX(o.end) : toZ(o.end);
      const minW = o.kind === "door" ? 0.8 : 0.6;
      if (end - start < minW) {
        const m = (start + end) / 2;
        start = m - minW / 2;
        end = m + minW / 2;
      }
      return { kind: o.kind, start, end, index: o.index };
    });
    const spec: WallSpec = {
      wall: alongX ? "far" : "left",
      a0: alongX ? toX(wall.a0) : toZ(wall.a0),
      a1: alongX ? toX(wall.a1) : toZ(wall.a1),
      at: alongX ? toZ(wall.at) : toX(wall.at),
      outward: 1,
      openings,
      wallH: WALL_H,
      centered: true,
    };
    const g = buildWall(THREE, mats, spec, COLORS.wall);
    scene.add(g);
    outlineMarked(g);
  }

  // Furniture, per room, from the room's own layout (so it matches the room render exactly).
  for (const room of rooms) {
    const local = roomLocalBoxes(house, room.index);
    const rw = room.x1 - room.x0;
    const rd = room.z1 - room.z0;
    for (const b of local) {
      if (isOpeningLabel(b.label) || isHelperLabel(b.label)) continue;
      const [ymin, xmin, ymax, xmax] = b.box_2d;
      const cx = room.x0 + ((xmin + xmax) / 2000) * rw;
      const cz = room.z0 + ((ymin + ymax) / 2000) * rd;
      const bw = Math.max(0.2, (Math.abs(xmax - xmin) / 1000) * rw);
      const bd = Math.max(0.2, (Math.abs(ymax - ymin) / 1000) * rd);
      const facing = facingWall(b, local, room.spot);
      const sideways = facing === "left" || facing === "right";
      const category = furnitureCategory(b.label);
      const proxy = buildFurniture(
        THREE,
        mats,
        category,
        b.label,
        CATEGORY_COLOR[category],
        sideways ? bd : bw,
        furnitureHeight(b.label),
        sideways ? bw : bd,
      );
      proxy.position.set(cx, 0, cz);
      proxy.rotation.y = facingRotation(facing);
      proxy.userData.roomIndex = room.index;
      scene.add(proxy);
      outlineMarked(proxy);
    }
  }

  const highlight = (index: number | null) => {
    floors.forEach((f, i) => {
      (f.material as import("three").MeshLambertMaterial).color.setHex(i === index ? FLOOR_SELECTED : COLORS.floor);
    });
  };
  const dispose = () => {
    scene.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = (mesh as unknown as { material?: import("three").Material }).material;
      if (m && typeof m.dispose === "function") m.dispose();
    });
    edgeMat.dispose();
  };
  return { scene, width: W, depth: D, rooms, highlight, dispose };
}

/**
 * A classic axonometric camera over the house: orthographic, from the
 * plan's bottom-right corner side, high enough to see into every room, with
 * the frustum fitted to the house so it fills the frame.
 */
export function houseIsoCamera(
  THREE: ThreeNS,
  a: AssembledHouse,
  aspect: number,
): import("three").OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const cx = a.width / 2;
  const cz = a.depth / 2;
  const dist = Math.max(a.width, a.depth) * 3 + 10;
  const dir = new THREE.Vector3(1, 1.15, 1).normalize();
  cam.position.set(cx + dir.x * dist, dir.y * dist, cz + dir.z * dist);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld();
  fitOrtho(THREE, cam, a, aspect);
  return cam;
}

/** Fit an orthographic camera's frustum to the house's bounding box as seen from it. */
export function fitOrtho(
  THREE: ThreeNS,
  cam: import("three").OrthographicCamera,
  a: AssembledHouse,
  aspect: number,
): void {
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  for (const x of [-0.6, a.width + 0.6]) {
    for (const y of [0, WALL_H]) {
      for (const z of [-0.6, a.depth + 0.6]) {
        v.set(x, y, z).applyMatrix4(inv);
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  }
  let halfW = ((maxX - minX) / 2) * 1.04;
  let halfH = ((maxY - minY) / 2) * 1.04;
  if (halfW / halfH < aspect) halfW = halfH * aspect;
  else halfH = halfW / aspect;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  cam.left = midX - halfW;
  cam.right = midX + halfW;
  cam.top = midY + halfH;
  cam.bottom = midY - halfH;
  cam.updateProjectionMatrix();
}

/**
 * Offscreen axonometric render of the house as a PNG data URL: the exact
 * massing the AI overview is styled from, and the evidence the user sees.
 * Null when there is no WebGL (the flow continues without it).
 */
export async function renderHouseIso(
  house: HouseModel,
  opts: { width?: number; height?: number } = {},
): Promise<string | null> {
  if (!house.rooms.length || typeof document === "undefined") return null;
  const width = opts.width ?? 1024;
  const height = opts.height ?? 768;
  let THREE: ThreeNS;
  try {
    THREE = await import("three");
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let renderer: import("three").WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  let assembled: AssembledHouse | null = null;
  try {
    renderer.setSize(width, height, false);
    renderer.setClearColor(0xf1efeb, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    assembled = assembleHouse(THREE, house);
    const cam = houseIsoCamera(THREE, assembled, width / height);
    renderer.render(assembled.scene, cam);
    const url = canvas.toDataURL("image/png");
    assembled.dispose();
    renderer.dispose();
    return url;
  } catch (e) {
    if (typeof console !== "undefined") console.debug("[voxa] house iso render failed", e);
    try {
      assembled?.dispose();
      renderer.dispose();
    } catch {
      /* ignore */
    }
    return null;
  }
}
