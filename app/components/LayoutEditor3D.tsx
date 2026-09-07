"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { assembleScene, CEILING_HEIGHT, makeRenderCamera, roomFootprint, type AssembledScene } from "@/lib/blockout";
import {
  boxCenter,
  isOpeningLabel,
  nearestWall,
  type RoomSize,
  type SpatialBox,
  type Wall,
} from "@/lib/spatial";

type ThreeNS = typeof import("three");
type OrbitControlsT = import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
type Box4 = [number, number, number, number];

interface Props {
  boxes: SpatialBox[];
  /** Pixel aspect (w/h) of the room crop. */
  cropAspect: number;
  /** Real room size in metres, if known. */
  roomSize: RoomSize | null;
  /** Every edit reports the full new list; the parent rebuilds the lock. */
  onChange: (boxes: SpatialBox[]) => void;
  onRoomSizeChange: (size: RoomSize) => void;
}

/** What can be added, with a sensible footprint in metres. */
const PALETTE: { label: string; w: number; d: number }[] = [
  { label: "bed", w: 1.6, d: 2.0 },
  { label: "nightstand", w: 0.5, d: 0.4 },
  { label: "wardrobe", w: 1.8, d: 0.6 },
  { label: "dresser", w: 1.2, d: 0.5 },
  { label: "sofa", w: 2.2, d: 0.9 },
  { label: "armchair", w: 0.9, d: 0.9 },
  { label: "coffee table", w: 1.0, d: 0.6 },
  { label: "ottoman", w: 0.6, d: 0.6 },
  { label: "dining table", w: 1.6, d: 0.9 },
  { label: "chair", w: 0.5, d: 0.5 },
  { label: "desk", w: 1.4, d: 0.7 },
  { label: "bookshelf", w: 1.0, d: 0.35 },
  { label: "cabinet", w: 1.2, d: 0.5 },
  { label: "tv unit", w: 1.6, d: 0.45 },
  { label: "rug", w: 2.0, d: 1.5 },
  { label: "plant", w: 0.5, d: 0.5 },
  { label: "floor lamp", w: 0.4, d: 0.4 },
  { label: "bathtub", w: 1.7, d: 0.75 },
  { label: "shower", w: 0.9, d: 0.9 },
  { label: "toilet", w: 0.4, d: 0.65 },
  { label: "sink", w: 0.6, d: 0.45 },
  { label: "door", w: 0.9, d: 0 },
  { label: "window", w: 1.2, d: 0 },
];

const OPENING_T = 40; // how far an opening's box reaches into the room (0-1000 units)
const OPPOSITE: Record<Wall, Wall> = { far: "near", near: "far", left: "right", right: "left" };
const clampU = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/** A box hugging `wall`, centred at `along` (0-1000 along the wall) with span `len`. */
function wallHugBox(wall: Wall, along: number, len: number): Box4 {
  const a0 = clampU(along - len / 2);
  const a1 = clampU(along + len / 2);
  switch (wall) {
    case "far":
      return [0, a0, OPENING_T, a1];
    case "near":
      return [1000 - OPENING_T, a0, 1000, a1];
    case "left":
      return [a0, 0, a1, OPENING_T];
    default:
      return [a0, 1000 - OPENING_T, a1, 1000];
  }
}

/**
 * The clay room as a live, editable Three.js scene. Orbit to inspect, click a
 * piece to select it, drag it across the floor (doors and windows snap to
 * the nearest wall), Delete to remove, add from the palette, set sizes and
 * the room's own size. The scene is the SAME assembly the render uses
 * (`assembleScene`), and every edit goes back into the box list, so the 2D
 * overlay, this view and the final render can never disagree.
 */
export default function LayoutEditor3D({ boxes, cropAspect, roomSize, onChange, onRoomSizeChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [labelText, setLabelText] = useState("");
  const [addLabel, setAddLabel] = useState(PALETTE[0].label);
  const [rebuilds, setRebuilds] = useState(0);

  // Three.js objects live outside React state.
  const t = useRef<{
    THREE: ThreeNS;
    renderer: import("three").WebGLRenderer;
    camera: import("three").PerspectiveCamera;
    controls: OrbitControlsT;
    assembled: AssembledScene | null;
    helper: import("three").BoxHelper | null;
    raycaster: import("three").Raycaster;
    floor: import("three").Plane;
    drag: { index: number; opening: boolean; offset: import("three").Vector3; moved: boolean; start: { x: number; y: number } } | null;
  } | null>(null);

  const { roomW, roomD } = roomFootprint(cropAspect, roomSize);

  const select = useCallback((i: number | null) => {
    selectedRef.current = i;
    setSelected(i);
  }, []);

  // Selected object → helper outline.
  const refreshHelper = useCallback(() => {
    const s = t.current;
    if (!s || !s.assembled) return;
    if (s.helper) {
      s.assembled.scene.remove(s.helper);
      s.helper.geometry.dispose();
      (s.helper.material as import("three").Material).dispose();
      s.helper = null;
    }
    const i = selectedRef.current;
    if (i === null) return;
    const obj = findByIndex(s.assembled.scene, i);
    if (!obj) return;
    s.helper = new s.THREE.BoxHelper(obj, 0xfacc15);
    s.assembled.scene.add(s.helper);
  }, []);

  // Mount: renderer, camera, controls, loop, pointer handlers.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let canvas: HTMLCanvasElement | null = null;
    const handlers: Array<[string, (e: PointerEvent) => void]> = [];

    (async () => {
      let THREE: ThreeNS;
      let OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
      try {
        THREE = await import("three");
        ({ OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js"));
      } catch {
        setFailed(true);
        return;
      }
      if (disposed) return;
      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setFailed(true);
        return;
      }
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0xd9d6d0, 1);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      canvas = renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      canvas.style.touchAction = "none";
      host.appendChild(canvas);

      const camera = new THREE.PerspectiveCamera(72, 4 / 3, 0.05, 100);
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.maxPolarAngle = Math.PI / 2 - 0.02; // never below the floor
      controls.minDistance = 0.5;
      controls.maxDistance = 25;

      t.current = {
        THREE,
        renderer,
        camera,
        controls,
        assembled: null,
        helper: null,
        raycaster: (() => {
          const r = new THREE.Raycaster();
          // Outline lines would otherwise be "hit" from a metre away and
          // shadow the mesh under the cursor.
          r.params.Line = { threshold: 0.02 };
          return r;
        })(),
        floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        drag: null,
      };

      const size = () => {
        const w = host.clientWidth || 640;
        const h = host.clientHeight || Math.round(w * 0.75);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      size();
      ro = new ResizeObserver(size);
      ro.observe(host);

      const ndc = (e: PointerEvent) => {
        const r = canvas!.getBoundingClientRect();
        return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      };
      const floorHit = (e: PointerEvent) => {
        const s = t.current!;
        s.raycaster.setFromCamera(ndc(e), s.camera);
        const p = new THREE.Vector3();
        return s.raycaster.ray.intersectPlane(s.floor, p) ? p : null;
      };
      const onDown = (e: PointerEvent) => {
        const s = t.current;
        if (!s || !s.assembled || e.button !== 0) return;
        s.raycaster.setFromCamera(ndc(e), s.camera);
        const hits = s.raycaster.intersectObjects(s.assembled.scene.children, true);
        let index: number | null = null;
        for (const h of hits) {
          // Raycasting ignores `visible`: skip the lifted ceiling and the
          // selection helper, or a top-view click would land on them.
          if (h.object === s.helper || !visibleChain(h.object)) continue;
          const i = ownerIndex(h.object);
          if (i !== null) {
            index = i;
            break;
          }
          // The first thing hit is a wall/floor → nothing selectable in front.
          break;
        }
        if (index === null) {
          select(null);
          refreshHelper();
          return;
        }
        select(index);
        refreshHelper();
        const box = boxesRef.current[index];
        const opening = isOpeningLabel(box.label);
        const p = floorHit(e);
        const obj = findByIndex(s.assembled.scene, index);
        const offset = new THREE.Vector3();
        if (p && obj && !opening) offset.copy(obj.position).sub(p);
        s.drag = { index, opening, offset, moved: false, start: { x: e.clientX, y: e.clientY } };
        s.controls.enabled = false;
        canvas!.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        const s = t.current;
        if (!s || !s.drag || !s.assembled) return;
        const d = s.drag;
        if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 3) d.moved = true;
        if (!d.moved || d.opening) return;
        const p = floorHit(e);
        const obj = findByIndex(s.assembled.scene, d.index);
        if (!p || !obj) return;
        const { roomW, roomD } = s.assembled;
        const [ymin, xmin, ymax, xmax] = boxesRef.current[d.index].box_2d;
        const hw = ((xmax - xmin) / 1000) * roomW * 0.5;
        const hd = ((ymax - ymin) / 1000) * roomD * 0.5;
        const nx = Math.max(hw, Math.min(roomW - hw, p.x + d.offset.x));
        const nz = Math.max(hd, Math.min(roomD - hd, p.z + d.offset.z));
        obj.position.set(nx, 0, nz);
        s.helper?.update();
      };
      const onUp = (e: PointerEvent) => {
        const s = t.current;
        if (!s || !s.drag) return;
        const d = s.drag;
        s.drag = null;
        s.controls.enabled = true;
        try {
          canvas!.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (!d.moved || !s.assembled) return;
        const { roomW, roomD } = s.assembled;
        const boxesNow = boxesRef.current;
        const b = boxesNow[d.index];
        const [ymin, xmin, ymax, xmax] = b.box_2d;
        let next: Box4;
        if (d.opening) {
          const p = floorHit(e);
          if (!p) return;
          const ux = clampU((p.x / roomW) * 1000);
          const uy = clampU((p.z / roomD) * 1000);
          const wall = nearestWall(ux, uy);
          const alongX = wall === "far" || wall === "near";
          const wasAlongX = ymax - ymin < xmax - xmin;
          const len = wasAlongX ? xmax - xmin : ymax - ymin;
          next = wallHugBox(wall, alongX ? ux : uy, len);
        } else {
          const obj = findByIndex(s.assembled.scene, d.index);
          if (!obj) return;
          const w = xmax - xmin;
          const h = ymax - ymin;
          const cx = (obj.position.x / roomW) * 1000;
          const cy = (obj.position.z / roomD) * 1000;
          next = [clampU(cy - h / 2), clampU(cx - w / 2), clampU(cy + h / 2), clampU(cx + w / 2)];
        }
        onChangeRef.current(boxesNow.map((bb, i) => (i === d.index ? { ...bb, box_2d: next } : bb)));
      };
      handlers.push(["pointerdown", onDown], ["pointermove", onMove], ["pointerup", onUp], ["pointercancel", onUp]);
      for (const [k, h] of handlers) canvas.addEventListener(k, h as EventListener);

      const loop = () => {
        if (disposed) return;
        const s = t.current;
        if (s?.assembled) {
          s.controls.update();
          // From above the ceiling would hide the whole room: lift it off.
          const ceiling = s.assembled.scene.getObjectByName("ceiling");
          if (ceiling) ceiling.visible = s.camera.position.y < CEILING_HEIGHT - 0.05;
          s.renderer.render(s.assembled.scene, s.camera);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      setReady(true);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      const s = t.current;
      if (canvas) for (const [k, h] of handlers) canvas.removeEventListener(k, h as EventListener);
      if (s) {
        s.assembled?.dispose();
        s.controls.dispose();
        s.renderer.dispose();
        s.renderer.domElement.remove();
      }
      t.current = null;
    };
  }, [select, refreshHelper]);

  // (Re)build the scene whenever the boxes or the room change.
  useEffect(() => {
    const s = t.current;
    if (!ready || !s) return;
    const first = !s.assembled;
    s.assembled?.dispose();
    s.helper = null;
    s.assembled = assembleScene(s.THREE, boxes, cropAspect, { roomSize });
    if (first) {
      const cam = makeRenderCamera(s.THREE, s.assembled, s.camera.aspect);
      s.camera.position.copy(cam.position);
      s.controls.target.set(...s.assembled.view.target);
      s.controls.update();
    }
    refreshHelper();
    setRebuilds((n) => n + 1);
  }, [ready, boxes, cropAspect, roomSize, refreshHelper]);

  useEffect(() => {
    if (selected !== null && selected >= boxes.length) select(null);
    setLabelText(selected !== null && boxes[selected] ? boxes[selected].label : "");
  }, [selected, boxes, select]);

  // ---- toolbar actions -------------------------------------------------
  const entryView = () => {
    const s = t.current;
    if (!s?.assembled) return;
    const cam = makeRenderCamera(s.THREE, s.assembled, s.camera.aspect);
    s.camera.position.copy(cam.position);
    s.controls.target.set(...s.assembled.view.target);
    s.controls.update();
  };
  const topView = () => {
    const s = t.current;
    if (!s?.assembled) return;
    const { roomW, roomD } = s.assembled;
    s.camera.position.set(roomW / 2, Math.max(roomW, roomD) * 1.4, roomD / 2 + 0.01);
    s.controls.target.set(roomW / 2, 0, roomD / 2);
    s.controls.update();
  };
  const remove = () => {
    if (selected === null) return;
    const next = boxes.filter((_, i) => i !== selected);
    select(null);
    onChange(next);
  };
  const relabel = () => {
    if (selected === null) return;
    const label = labelText.trim().toLowerCase();
    if (!label || label === boxes[selected].label) return;
    onChange(boxes.map((b, i) => (i === selected ? { ...b, label } : b)));
  };
  const resize = (wM: number, dM: number) => {
    if (selected === null) return;
    const b = boxes[selected];
    const c = boxCenter(b);
    const w = Math.max(20, (wM / roomW) * 1000);
    const h = Math.max(20, (dM / roomD) * 1000);
    const next: Box4 = [clampU(c.cy - h / 2), clampU(c.cx - w / 2), clampU(c.cy + h / 2), clampU(c.cx + w / 2)];
    onChange(boxes.map((bb, i) => (i === selected ? { ...bb, box_2d: next } : bb)));
  };
  const rotate = () => {
    if (selected === null) return;
    const [ymin, xmin, ymax, xmax] = boxes[selected].box_2d;
    const wM = ((xmax - xmin) / 1000) * roomW;
    const dM = ((ymax - ymin) / 1000) * roomD;
    resize(dM, wM);
  };
  const add = () => {
    const item = PALETTE.find((p) => p.label === addLabel) ?? PALETTE[0];
    const s = t.current;
    let box: Box4;
    if (isOpeningLabel(item.label)) {
      // On the wall facing the camera, mid-way, so it is in frame at once.
      const wall = s?.assembled ? OPPOSITE[s.assembled.spot.wall] : "far";
      box = wallHugBox(wall, 500, (item.w / roomW) * 1000);
    } else {
      const w = (item.w / roomW) * 1000;
      const h = (item.d / roomD) * 1000;
      box = [clampU(500 - h / 2), clampU(500 - w / 2), clampU(500 + h / 2), clampU(500 + w / 2)];
    }
    const next = [...boxes, { label: item.label, box_2d: box }];
    select(next.length - 1);
    onChange(next);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && (e.target as HTMLElement).tagName !== "INPUT") {
      e.preventDefault();
      remove();
    }
    if (e.key === "Escape") {
      select(null);
      refreshHelper();
    }
  };

  const sel = selected !== null ? boxes[selected] : null;
  const selW = sel ? (((sel.box_2d[3] - sel.box_2d[1]) / 1000) * roomW).toFixed(2) : "";
  const selD = sel ? (((sel.box_2d[2] - sel.box_2d[0]) / 1000) * roomD).toFixed(2) : "";
  const selOpening = sel ? isOpeningLabel(sel.label) : false;
  void rebuilds;

  return (
    <div className="space-y-2" onKeyDown={onKey}>
      <div
        ref={hostRef}
        tabIndex={0}
        className="media-frame relative aspect-[4/3] w-full overflow-hidden bg-[#d9d6d0] outline-none focus:ring-2 focus:ring-emerald-500/40"
        aria-label="Editable 3D layout of the room"
      >
        {failed && (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-600">
            3D editing needs WebGL, which this browser has turned off. The 2D boxes above still work.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={entryView} className="chip">
          Entry view
        </button>
        <button type="button" onClick={topView} className="chip">
          Top view
        </button>
        <span className="text-neutral-500">Drag to orbit · scroll to zoom · click a piece, then drag it.</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={addLabel}
          onChange={(e) => setAddLabel(e.target.value)}
          aria-label="Item to add"
          className="rounded-md border border-white/10 bg-neutral-950/60 px-2 py-1 text-neutral-100 outline-none focus:border-emerald-500/70"
        >
          {PALETTE.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={add} className="chip">
          + Add
        </button>
        <span className="ml-auto flex items-center gap-1 text-neutral-400">
          Room
          <input
            type="number"
            step={0.1}
            min={1}
            value={roomW.toFixed(2)}
            onChange={(e) => onRoomSizeChange({ width: Number(e.target.value) || roomW, depth: roomD })}
            aria-label="Room width in metres"
            className="w-16 rounded-md border border-white/10 bg-neutral-950/60 px-1 py-1 text-right text-neutral-100 outline-none focus:border-emerald-500/70"
          />
          ×
          <input
            type="number"
            step={0.1}
            min={1}
            value={roomD.toFixed(2)}
            onChange={(e) => onRoomSizeChange({ width: roomW, depth: Number(e.target.value) || roomD })}
            aria-label="Room depth in metres"
            className="w-16 rounded-md border border-white/10 bg-neutral-950/60 px-1 py-1 text-right text-neutral-100 outline-none focus:border-emerald-500/70"
          />
          m
        </span>
      </div>

      {sel && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-xs">
          <span className="text-amber-300">Selected</span>
          <input
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
            onBlur={relabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Label of the selected item"
            className="w-32 rounded-md border border-white/10 bg-neutral-950/60 px-2 py-1 text-neutral-100 outline-none focus:border-emerald-500/70"
          />
          {!selOpening && (
            <>
              <label className="flex items-center gap-1 text-neutral-400">
                W
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  defaultValue={selW}
                  key={`w-${selected}-${selW}`}
                  onBlur={(e) => resize(Number(e.target.value) || Number(selW), Number(selD))}
                  aria-label="Width in metres"
                  className="w-16 rounded-md border border-white/10 bg-neutral-950/60 px-1 py-1 text-right text-neutral-100 outline-none focus:border-emerald-500/70"
                />
              </label>
              <label className="flex items-center gap-1 text-neutral-400">
                D
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  defaultValue={selD}
                  key={`d-${selected}-${selD}`}
                  onBlur={(e) => resize(Number(selW), Number(e.target.value) || Number(selD))}
                  aria-label="Depth in metres"
                  className="w-16 rounded-md border border-white/10 bg-neutral-950/60 px-1 py-1 text-right text-neutral-100 outline-none focus:border-emerald-500/70"
                />
              </label>
              <button type="button" onClick={rotate} className="chip">
                Rotate 90°
              </button>
            </>
          )}
          {selOpening && <span className="text-neutral-500">Drag it onto any wall; it snaps there.</span>}
          <button type="button" onClick={remove} className="chip text-red-300">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** The box index an object belongs to, walking up to the tagged proxy group. */
function ownerIndex(o: import("three").Object3D | null): number | null {
  let cur: import("three").Object3D | null = o;
  while (cur) {
    const i = cur.userData?.boxIndex;
    if (typeof i === "number") return i;
    cur = cur.parent;
  }
  return null;
}

/** Visible, and every ancestor visible. */
function visibleChain(o: import("three").Object3D | null): boolean {
  let cur: import("three").Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

/** The proxy group (or opening panel) for a box index. */
function findByIndex(scene: import("three").Scene, index: number): import("three").Object3D | null {
  let found: import("three").Object3D | null = null;
  scene.traverse((o) => {
    if (!found && o.userData?.boxIndex === index) found = o;
  });
  return found;
}
