"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { assembleHouse, houseIsoCamera, type AssembledHouse } from "@/lib/houseScene";
import { roomLocalBoxes, roomSizeOf, type HouseModel } from "@/lib/house";
import { WALL_H } from "@/lib/blockout";
import { cameraSpot, isHelperLabel, isOpeningLabel } from "@/lib/spatial";

type ThreeNS = typeof import("three");
type OrbitControlsT = import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;

interface Props {
  planDataUrl: string;
  house: HouseModel;
  selected: number | null;
  onSelect: (index: number | null) => void;
}

/**
 * The whole house as a live Three.js model beside the plan. Click a room in
 * either — its floor in 3D, or its rectangle on the plan — to pick it; the
 * green marker shows where the entry camera will stand for the render, and
 * "Entry view" puts the orbit camera exactly there, inside the house model.
 */
export default function HouseView({ planDataUrl, house, selected, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const t = useRef<{
    THREE: ThreeNS;
    renderer: import("three").WebGLRenderer;
    camera: import("three").PerspectiveCamera;
    controls: OrbitControlsT;
    assembled: AssembledHouse | null;
    marker: import("three").Group | null;
    raycaster: import("three").Raycaster;
  } | null>(null);

  // Mount: renderer, camera, controls, click-to-select.
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
      renderer.setClearColor(0xf1efeb, 1);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      canvas = renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      canvas.style.touchAction = "none";
      host.appendChild(canvas);

      const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.05, 500);
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      controls.minDistance = 0.5;
      controls.maxDistance = 120;

      const raycaster = new THREE.Raycaster();
      raycaster.params.Line = { threshold: 0.02 };
      t.current = { THREE, renderer, camera, controls, assembled: null, marker: null, raycaster };

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

      let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        if (e.button === 0) down = { x: e.clientX, y: e.clientY };
      };
      const onUp = (e: PointerEvent) => {
        const s = t.current;
        if (!down || !s?.assembled) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
        down = null;
        if (moved) return; // an orbit drag, not a click
        const r = canvas!.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        s.raycaster.setFromCamera(ndc, s.camera);
        const hits = s.raycaster.intersectObjects(s.assembled.scene.children, true);
        for (const h of hits) {
          if (s.marker && isDescendant(h.object, s.marker)) continue;
          const i = ownerRoom(h.object);
          onSelectRef.current(i);
          return;
        }
        onSelectRef.current(null);
      };
      handlers.push(["pointerdown", onDown], ["pointerup", onUp]);
      for (const [k, h] of handlers) canvas.addEventListener(k, h as EventListener);

      const loop = () => {
        if (disposed) return;
        const s = t.current;
        if (s?.assembled) {
          s.controls.update();
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
  }, []);

  const isoView = useCallback(() => {
    const s = t.current;
    if (!s?.assembled) return;
    const iso = houseIsoCamera(s.THREE, s.assembled, s.camera.aspect);
    // Same direction as the axonometric render, at a perspective-friendly distance.
    const a = s.assembled;
    const dir = iso.position.clone().sub(new s.THREE.Vector3(a.width / 2, 0, a.depth / 2)).normalize();
    const dist = Math.max(a.width, a.depth) * 1.55 + 3;
    s.camera.position.set(a.width / 2 + dir.x * dist, dir.y * dist, a.depth / 2 + dir.z * dist);
    s.controls.target.set(a.width / 2, 0, a.depth / 2);
    s.controls.update();
  }, []);

  // (Re)build when the house changes.
  useEffect(() => {
    const s = t.current;
    if (!ready || !s) return;
    const first = !s.assembled;
    s.assembled?.dispose();
    s.marker = null;
    s.assembled = assembleHouse(s.THREE, house);
    if (first) isoView();
  }, [ready, house, isoView]);

  // Selection: tint the floor, show the entry-camera marker.
  useEffect(() => {
    const s = t.current;
    if (!ready || !s?.assembled) return;
    const a = s.assembled;
    a.highlight(selected);
    if (s.marker) {
      a.scene.remove(s.marker);
      s.marker = null;
    }
    if (selected === null || !a.rooms[selected]) return;
    const { entry } = a.rooms[selected];
    const THREE = s.THREE;
    const g = new THREE.Group();
    const from = new THREE.Vector3(...entry.pos);
    const to = new THREE.Vector3(...entry.target);
    const dir = to.clone().sub(from).normalize();
    g.add(new THREE.ArrowHelper(dir, from, 1.2, 0x34d399, 0.35, 0.22));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: 0x34d399 }));
    eye.position.copy(from);
    g.add(eye);
    g.name = "camera-marker";
    a.scene.add(g);
    s.marker = g;
  }, [ready, selected, house]);

  const topView = () => {
    const s = t.current;
    if (!s?.assembled) return;
    const a = s.assembled;
    s.camera.position.set(a.width / 2, Math.max(a.width, a.depth) * 1.35 + WALL_H, a.depth / 2 + 0.01);
    s.controls.target.set(a.width / 2, 0, a.depth / 2);
    s.controls.update();
  };
  const entryView = () => {
    const s = t.current;
    if (!s?.assembled || selected === null || !s.assembled.rooms[selected]) return;
    const { preview } = s.assembled.rooms[selected];
    s.camera.position.set(...preview.pos);
    s.controls.target.set(...preview.target);
    s.controls.update();
  };

  const sel = selected !== null ? house.rooms[selected] : null;
  const selSize = selected !== null ? roomSizeOf(house, selected) : null;
  const selSpot = selected !== null ? cameraSpot(roomLocalBoxes(house, selected)) : null;
  const items = (i: number) =>
    house.furniture.filter((f) => !isHelperLabel(f.label) && inside(house.rooms[i].box_2d, f.box_2d)).length;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-2">
          <div
            ref={hostRef}
            className="media-frame relative aspect-[4/3] w-full overflow-hidden bg-[#f1efeb]"
            aria-label="3D model of the whole plan; click a room to pick it"
          >
            {failed && (
              <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-neutral-600">
                The 3D model needs WebGL, which this browser has turned off. Pick a room on the plan instead.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={isoView} className="chip">
              Axonometric
            </button>
            <button type="button" onClick={topView} className="chip">
              Top view
            </button>
            <button type="button" onClick={entryView} disabled={selected === null} className="chip disabled:opacity-40">
              Entry view of selected room
            </button>
            <span className="text-neutral-500">Drag to orbit · scroll to zoom · click a room to pick it.</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="media-frame relative select-none bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={planDataUrl} alt="2D floor plan with the detected rooms" className="block w-full" draggable={false} />
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              onPointerDown={() => onSelect(null)}
            >
              {house.rooms.map((r, i) => {
                const [ymin, xmin, ymax, xmax] = r.box_2d;
                const isSel = selected === i;
                return (
                  <g key={i}>
                    <rect
                      x={xmin}
                      y={ymin}
                      width={Math.max(1, xmax - xmin)}
                      height={Math.max(1, ymax - ymin)}
                      fill={isSel ? "#34d399" : "#38bdf8"}
                      fillOpacity={isSel ? 0.35 : 0.1}
                      stroke={isSel ? "#34d399" : "#38bdf8"}
                      strokeWidth={isSel ? 8 : 4}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "pointer" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect(i);
                      }}
                    />
                    <text
                      x={xmin + (xmax - xmin) / 2}
                      y={ymin + (ymax - ymin) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={isSel ? "#065f46" : "#0c4a6e"}
                      fontSize={34}
                      fontWeight={600}
                      style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 6, pointerEvents: "none" }}
                    >
                      {r.label}
                    </text>
                  </g>
                );
              })}
              {house.openings.map((o, i) => {
                const [ymin, xmin, ymax, xmax] = o.box_2d;
                return (
                  <rect
                    key={`o${i}`}
                    x={xmin}
                    y={ymin}
                    width={Math.max(6, xmax - xmin)}
                    height={Math.max(6, ymax - ymin)}
                    fill={isOpeningLabel(o.label) && /door/.test(o.label) ? "#f59e0b" : "#a855f7"}
                    fillOpacity={0.55}
                    style={{ pointerEvents: "none" }}
                  />
                );
              })}
            </svg>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {house.rooms.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(selected === i ? null : i)}
                className={`chip ${selected === i ? "chip-active" : ""}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {sel && selSize && (
            <p className="text-xs text-neutral-400">
              <span className="text-neutral-100">{sel.label}</span> · {selSize.width.toFixed(1)} × {selSize.depth.toFixed(1)} m ·{" "}
              {items(selected!)} item{items(selected!) === 1 ? "" : "s"} · camera{" "}
              {selSpot?.atDoor ? "in the doorway" : "at the emptiest wall (no usable door)"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function inside(room: [number, number, number, number], b: [number, number, number, number]): boolean {
  const cx = (b[1] + b[3]) / 2;
  const cy = (b[0] + b[2]) / 2;
  return cx >= room[1] && cx <= room[3] && cy >= room[0] && cy <= room[2];
}

/** The room index an object belongs to, walking up to the tagged floor/proxy. */
function ownerRoom(o: import("three").Object3D | null): number | null {
  let cur: import("three").Object3D | null = o;
  while (cur) {
    const i = cur.userData?.roomIndex;
    if (typeof i === "number") return i;
    cur = cur.parent;
  }
  return null;
}

function isDescendant(o: import("three").Object3D, root: import("three").Object3D): boolean {
  let cur: import("three").Object3D | null = o;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parent;
  }
  return false;
}
