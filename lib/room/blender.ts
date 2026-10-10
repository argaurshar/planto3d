// "Download for Blender": the exact room as a glTF binary plus a Blender
// Python script that rebuilds the shots and the lighting, zipped together.
//
//   room.glb               — geometry + PBR materials, the same scene as the app
//   render_in_blender.py   — imports room.glb, adds every preset camera (entry
//                            door at eye level, bed/sofa back, corners, top),
//                            daylight, window and ceiling lights, Cycles setup;
//                            run with `-- --render` to render every shot
//   room.json              — the room model itself
//   README.txt
//
// Browser only (the scene's textures are painted on canvases).

import type { RoomModel, Shot } from "./types";
import { loadThree } from "./kit";
import { buildRoomScene } from "./scene";
import { roomShots } from "./shots";
import { WALL_T } from "./constants";
import { moodOf, moodSpec } from "./moods";
import VOXA_RENDER_PY from "@/blender-server/voxa_render.py";

/** Plan/three coordinates → Blender (glTF import turns y-up into z-up). */
function bl(x: number, y: number, z: number): [number, number, number] {
  return [r3(x), r3(-z), r3(y)];
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A shot taken from behind a wall must not see that wall: the camera's clip
 * start cuts everything nearer than the wall's inner face. What hangs or stands
 * against that wall is hidden per camera by the script instead (clipping it
 * would also slice a sofa or headboard standing a few centimetres off the wall).
 */
function clipStart(room: RoomModel, s: Shot): number {
  const fx = s.target[0] - s.pos[0];
  const fz = s.target[2] - s.pos[2];
  const len = Math.hypot(fx, fz) || 1;
  const f = [fx / len, fz / len];
  const along = (x: number, z: number) => (x - s.pos[0]) * f[0] + (z - s.pos[2]) * f[1];
  let clip = 0.05;
  for (const name of s.hide) {
    if (!name.startsWith("wall:")) continue;
    const w = name.slice(5);
    const d = w === "top" ? along(s.pos[0], 0) : w === "bottom" ? along(s.pos[0], room.depth) : w === "left" ? along(0, s.pos[2]) : along(room.width, s.pos[2]);
    if (d > 0) clip = Math.max(clip, d + 0.005);
  }
  return r3(clip);
}

export interface LightSpec {
  kind: "sun" | "area" | "spot" | "point";
  name: string;
  loc: [number, number, number];
  target: [number, number, number];
  power: number;
  color: [number, number, number];
  size?: [number, number];
}

async function collectLights(room: RoomModel): Promise<LightSpec[]> {
  const T = await loadThree();
  const { THREE } = T;
  const rs = buildRoomScene(T, room, { lights: true });
  const out: LightSpec[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  rs.scene.updateMatrixWorld(true);
  rs.root.traverse((o) => {
    const l = o as import("three").Light;
    if (!l.isLight) return;
    l.getWorldPosition(p);
    const c = l.color;
    const color: [number, number, number] = [r3(c.r), r3(c.g), r3(c.b)];
    const ra = o as import("three").RectAreaLight;
    if (ra.isRectAreaLight) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
      q.copy(p).add(dir);
      const area = ra.width * ra.height;
      const cove = (o.parent?.name ?? "") === "ceiling";
      // Watts follow the three.js intensity, so a mood's dimmer sky or brighter coves carry over.
      const power = cove ? Math.max(ra.width, ra.height) * 25 * (ra.intensity / 3.2) : area * 90 * (ra.intensity / 4.5);
      out.push({ kind: "area", name: cove ? "Cove light" : "Window light", loc: bl(p.x, p.y, p.z), target: bl(q.x, q.y, q.z), power: r3(power), color, size: [r3(ra.width), r3(ra.height)] });
    } else if ((o as import("three").SpotLight).isSpotLight) {
      const s = o as import("three").SpotLight;
      s.target.getWorldPosition(q);
      out.push({ kind: "spot", name: "Downlight", loc: bl(p.x, p.y, p.z), target: bl(q.x, q.y, q.z), power: r3(30 * (s.intensity / 9)), color });
    } else if ((o as import("three").DirectionalLight).isDirectionalLight) {
      const d = o as import("three").DirectionalLight;
      d.target.getWorldPosition(q);
      out.push({ kind: "sun", name: "Sun", loc: bl(p.x, p.y, p.z), target: bl(q.x, q.y, q.z), power: r3(Math.min(4, d.intensity * 1.4)), color });
    } else if ((o as import("three").PointLight).isPointLight) {
      out.push({ kind: "point", name: "Lamp", loc: bl(p.x, p.y, p.z), target: bl(p.x, p.y - 1, p.z), power: r3(18 * (l.intensity / 3)), color });
    }
  });
  rs.dispose();
  return out;
}

/** Everything the Blender script needs besides the model: cameras and lights, in Blender coordinates. */
export function sceneData(room: RoomModel, lights: LightSpec[], shots: Shot[] = roomShots(room)) {
  const mood = moodSpec(room);
  return {
    room: { name: room.name, width: room.width, depth: room.depth, height: room.height, wall_t: WALL_T },
    // The mood's sky and exposure (its sun, sky panels and lamps are already in `lights`).
    mood: moodOf(room),
    world: { color: mood.world.color, strength: mood.world.strength },
    exposure: mood.blenderExposure,
    shots: shots.map((s) => ({
      id: s.id,
      name: s.label,
      loc: bl(...s.pos),
      target: bl(...s.target),
      fov: s.fov,
      // three.js lens shift is a fraction of the half frame height; Blender's is
      // a fraction of the frame width (4:3 → height/width = 0.75).
      shift_y: r3(s.shiftY * 0.5 * 0.75),
      clip_start: s.id === "top" ? 0.05 : clipStart(room, s),
      hide: s.hide,
    })),
    lights,
  };
}

/**
 * render_in_blender.py for the download: the scene data embedded as DATA_JSON
 * above the shared renderer (blender-server/voxa_render.py, the same file the
 * render server runs).
 */
export function blenderScript(room: RoomModel, lights: LightSpec[]): string {
  // No single quote can appear outside JSON strings, so escaping them keeps the raw ''' literal safe.
  const data = JSON.stringify(sceneData(room, lights), null, 1).replace(/'/g, "\\u0027");
  const title = room.name.replace(/[\r\n]+/g, " ");
  return `# ${title}: exact room model from Voxa (planto3d).
#
# Use it in Blender (4.2 or newer):
#   1. Unzip the package; keep room.glb next to this script.
#   2. Blender → Scripting workspace → Open → render_in_blender.py → Run Script.
#      You get the room, one camera per shot (look through one with Numpad 0),
#      daylight and the ceiling/window lights, and Cycles set up. Press F12 to render.
#   Or render every shot from a terminal (PNG files land in ./renders):
#      blender --background --python render_in_blender.py -- --render [--samples 128] [--percent 50] [shot-id …]

DATA_JSON = r'''${data}'''

${VOXA_RENDER_PY}`;
}

// ------------------------------------------------------------------ tiny zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A store-only (uncompressed) zip — small, dependency-free, opens everywhere. */
export function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

// --------------------------------------------------------------------- export

/** The room as a binary glTF (no lights: the Blender script adds its own). */
export async function roomGlb(room: RoomModel): Promise<ArrayBuffer> {
  const T = await loadThree();
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const rs = buildRoomScene(T, room, { lights: false });
  try {
    const out = await new GLTFExporter().parseAsync(rs.root, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
    if (!(out instanceof ArrayBuffer)) throw new Error("glTF export did not produce a binary file.");
    return out;
  } finally {
    rs.dispose();
  }
}

/**
 * What the render server takes: the model and the scene data for the shots to
 * render (custom camera views included). Never a script.
 */
export async function renderJobZip(room: RoomModel, shots: Shot[]): Promise<Blob> {
  const enc = new TextEncoder();
  const [glb, lights] = await Promise.all([roomGlb(room), collectLights(room)]);
  return zip([
    { name: "room.glb", data: new Uint8Array(glb) },
    { name: "scene.json", data: enc.encode(JSON.stringify(sceneData(room, lights, shots))) },
  ]);
}

export async function blenderPackage(room: RoomModel): Promise<Blob> {
  const enc = new TextEncoder();
  const [glb, lights] = await Promise.all([roomGlb(room), collectLights(room)]);
  const readme = `${room.name} — ${room.width.toFixed(2)} × ${room.depth.toFixed(2)} m, ceiling ${room.height.toFixed(2)} m

room.glb               The exact 3D room (metres, real materials). Blender: File → Import → glTF 2.0.
render_in_blender.py   Run it in Blender (Scripting → Open → Run Script): imports room.glb and adds
                       a camera for every shot, daylight + ceiling lights, and Cycles render settings.
                       Terminal: blender --background --python render_in_blender.py -- --render
room.json              The room model (dimensions, doors, windows, every piece of furniture).
`;
  return zip([
    { name: "room.glb", data: new Uint8Array(glb) },
    { name: "render_in_blender.py", data: enc.encode(blenderScript(room, lights)) },
    { name: "room.json", data: enc.encode(JSON.stringify(room, null, 2)) },
    { name: "README.txt", data: enc.encode(readme) },
  ]);
}

export async function downloadBlenderPackage(room: RoomModel): Promise<void> {
  const blob = await blenderPackage(room);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${room.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "room"}-blender.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
