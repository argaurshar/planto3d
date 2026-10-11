// Build the whole room — shell, furniture, lights — as one Three.js scene from
// a RoomModel. The same function feeds the live viewport, every raw shot and
// the Blender export, so what the user edits is exactly what is rendered.

import type { RoomModel } from "./types";
import type { ThreeBundle } from "./kit";
import { Kit } from "./kit";
import { Materials } from "./materials";
import { buildItem, type BuildCtx } from "./furniture";
import { buildDaylight, buildShell, FALSE_CEILING_DROP } from "./shell";
import { moodOf, moodSpec } from "./moods";

type Scene = import("three").Scene;
type Group = import("three").Group;

export interface RoomScene {
  scene: Scene;
  /** The room's root group (everything but the environment). */
  root: Group;
  /** Each item's group by item id (for selection and per-shot hiding). */
  items: Map<string, Group>;
  materials: Materials;
  ceilingClear: number;
  dispose(): void;
}

export interface SceneOptions {
  /** White clay materials everywhere, for checking geometry. */
  clay?: boolean;
  /** Include lights (the Blender export leaves them out and makes its own). */
  lights?: boolean;
}

export function buildRoomScene(T: ThreeBundle, room: RoomModel, opts: SceneOptions = {}): RoomScene {
  const { THREE } = T;
  const mood = moodSpec(room);
  const materials = new Materials(THREE, { style: room.style, clay: opts.clay, mood: moodOf(room), glow: mood.lamps });
  const k = new Kit(T, materials);
  k.lampScale = mood.lamps;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d9d6d0");
  const root = k.group(scene, "room");
  const ceilingClear = room.falseCeiling ? room.height - FALSE_CEILING_DROP : room.height;
  const ctx: BuildCtx = { k, m: materials, p: materials.palette, style: room.style, room, ceilingClear };

  buildShell(ctx, root);
  // Furniture gets eased edges (walls, frames and glass stay crisp).
  k.bevel = 0.004;
  const items = new Map<string, Group>();
  for (const it of room.items) {
    try {
      const g = buildItem(ctx, it);
      root.add(g);
      items.set(it.id, g);
    } catch (e) {
      // One bad item must never take the room down.
      if (typeof console !== "undefined") console.warn("[voxa] could not build", it.type, it.id, e);
    }
  }
  k.bevel = 0;
  if (opts.lights !== false) buildDaylight(ctx, root);
  else {
    // Strip lights the furniture added (lamps), the export makes its own.
    const lights: import("three").Object3D[] = [];
    root.traverse((o) => {
      if ((o as import("three").Light).isLight) lights.push(o);
    });
    for (const l of lights) l.removeFromParent();
  }

  const dispose = () => {
    root.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
    materials.dispose();
  };
  return { scene, root, items, materials, ceilingClear, dispose };
}
