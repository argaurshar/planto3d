"use client";

// The model drawn over the plan it was read from, so the user can see at a
// glance whether the walls, doors, windows and every piece landed where the
// drawing has them, and drag anything that did not. Every drag ends in one
// model edit (through the parent), so undo works as everywhere else.

import { useMemo, useRef, useState } from "react";
import type { Item, Opening, PlanFit, RoomModel } from "@/lib/room/types";
import type { PlanImage } from "@/lib/planFile";
import { CATALOG, itemLabel } from "@/lib/room/catalog";
import { clamp, footprint } from "@/lib/room/geometry";
import { wallLen } from "@/lib/room/place";
import { fromPlan, nearestWallAt, openingCentre, refitPlan, toPlan } from "@/lib/room/planFit";

type Box = PlanFit["box"];
/** Which outline edges a handle moves: left, top, right, bottom. */
type Edges = [boolean, boolean, boolean, boolean];

type Drag =
  | { kind: "item"; id: string; dx: number; dz: number; x: number; z: number; sx: number; sy: number; moved: boolean }
  | { kind: "opening"; id: string; x: number; z: number; sx: number; sy: number; moved: boolean }
  | { kind: "edges"; edges: Edges; box: Box; sx: number; sy: number; moved: boolean }
  | { kind: "draw"; p0: [number, number]; p1: [number, number] };

interface Props {
  room: RoomModel;
  image: PlanImage;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveItem: (id: string, x: number, z: number) => void;
  onMoveOpening: (id: string, x: number, z: number) => void;
  /** The outline was dragged onto the drawing's wall lines. */
  onRefit: (box: Box) => void;
  /** First fit, drawn by hand on a plan the AI did not read. */
  onFit: (box: Box) => void;
}

const OPENING_COLOR: Record<Opening["kind"], string> = { door: "#f97316", sliding: "#a855f7", window: "#0ea5e9", opening: "#64748b" };

const HANDLES: { edges: Edges; cursor: string; at: (b: Box) => [number, number] }[] = [
  { edges: [true, true, false, false], cursor: "nwse-resize", at: (b) => [b[0], b[1]] },
  { edges: [false, true, true, false], cursor: "nesw-resize", at: (b) => [b[2], b[1]] },
  { edges: [false, false, true, true], cursor: "nwse-resize", at: (b) => [b[2], b[3]] },
  { edges: [true, false, false, true], cursor: "nesw-resize", at: (b) => [b[0], b[3]] },
  { edges: [false, true, false, false], cursor: "ns-resize", at: (b) => [(b[0] + b[2]) / 2, b[1]] },
  { edges: [false, false, false, true], cursor: "ns-resize", at: (b) => [(b[0] + b[2]) / 2, b[3]] },
  { edges: [true, false, false, false], cursor: "ew-resize", at: (b) => [b[0], (b[1] + b[3]) / 2] },
  { edges: [false, false, true, false], cursor: "ew-resize", at: (b) => [b[2], (b[1] + b[3]) / 2] },
];

export default function PlanCheck({ room, image, selectedId, onSelect, onMoveItem, onMoveOpening, onRefit, onFit }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [whole, setWhole] = useState(false);
  const [labels, setLabels] = useState(true);
  const [strength, setStrength] = useState(0.75);

  const fit = room.plan;
  const IW = fit?.imageW ?? image.width;
  const IH = fit?.imageH ?? image.height;

  // The frame: the room with a margin (or the whole sheet). Fixed while dragging.
  const vb = useMemo(() => {
    if (!fit || whole) return [0, 0, IW, IH];
    const [x0, y0, x1, y1] = fit.box;
    const pad = 0.14 * Math.max(x1 - x0, y1 - y0);
    return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  }, [fit, whole, IW, IH]);
  // Text size in plan pixels that reads as ~12 px on screen (the frame is 4:3, the plan fitted inside it).
  const fs = Math.max(vb[2], (vb[3] * 4) / 3) / 70;

  const point = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };

  // The room as drawn: while the outline is dragged, the re-fit it will commit.
  const shown: RoomModel | null = fit ? (drag?.kind === "edges" ? refitPlan(room, drag.box) : room) : null;
  const box: Box | null = shown?.plan?.box ?? null;

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = point(e);
    if (!p) return;
    const target = (e.target as Element).closest("[data-kind]");
    const kind = target?.getAttribute("data-kind");
    const id = target?.getAttribute("data-id") ?? "";
    svg.current?.setPointerCapture(e.pointerId);
    if (!fit || !shown) {
      setDrag({ kind: "draw", p0: p, p1: p });
      return;
    }
    const [mx, mz] = fromPlan(room, fit, p[0], p[1]);
    if (kind === "item") {
      const it = room.items.find((i) => i.id === id);
      if (!it) return;
      onSelect(id);
      setDrag({ kind: "item", id, dx: it.x - mx, dz: it.z - mz, x: it.x, z: it.z, sx: e.clientX, sy: e.clientY, moved: false });
    } else if (kind === "opening") {
      const o = room.openings.find((x) => x.id === id);
      if (!o) return;
      const [x, z] = openingCentre(room, o);
      setDrag({ kind: "opening", id, x, z, sx: e.clientX, sy: e.clientY, moved: false });
    } else if (kind === "handle") {
      const edges = id.split("").map((c) => c === "1") as Edges;
      setDrag({ kind: "edges", edges, box: [...fit.box], sx: e.clientX, sy: e.clientY, moved: false });
    } else onSelect(null);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = point(e);
    if (!p) return;
    if (drag.kind === "draw") return setDrag({ ...drag, p1: p });
    const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3;
    if (!moved || !fit) return;
    const [mx, mz] = fromPlan(room, fit, p[0], p[1]);
    if (drag.kind === "item") setDrag({ ...drag, x: mx + drag.dx, z: mz + drag.dz, moved });
    else if (drag.kind === "opening") setDrag({ ...drag, x: mx, z: mz, moved });
    else {
      const b: Box = [...fit.box];
      const [l, t, r, bt] = drag.edges;
      if (l) b[0] = Math.min(p[0], b[2] - 10);
      if (t) b[1] = Math.min(p[1], b[3] - 10);
      if (r) b[2] = Math.max(p[0], b[0] + 10);
      if (bt) b[3] = Math.max(p[1], b[1] + 10);
      setDrag({ ...drag, box: b, moved });
    }
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag;
    setDrag(null);
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === "draw") {
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const b: Box = [
        r1(clamp(Math.min(d.p0[0], d.p1[0]), 0, IW)),
        r1(clamp(Math.min(d.p0[1], d.p1[1]), 0, IH)),
        r1(clamp(Math.max(d.p0[0], d.p1[0]), 0, IW)),
        r1(clamp(Math.max(d.p0[1], d.p1[1]), 0, IH)),
      ];
      if (b[2] - b[0] > 20 && b[3] - b[1] > 20) onFit(b);
      return;
    }
    if (!d.moved) return;
    if (d.kind === "item") onMoveItem(d.id, Math.round(d.x * 100) / 100, Math.round(d.z * 100) / 100);
    else if (d.kind === "opening") onMoveOpening(d.id, d.x, d.z);
    else onRefit(d.box.map((v) => Math.round(v * 10) / 10) as Box);
  };

  // ------------------------------------------------------------------ drawing

  const itemShape = (it: Item, r: RoomModel, f: PlanFit) => {
    const at = drag?.kind === "item" && drag.id === it.id ? { ...it, x: drag.x, z: drag.z } : it;
    const fp = footprint(at);
    const [x0, y0] = toPlan(r, f, fp.x0, fp.z0);
    const [x1, y1] = toPlan(r, f, fp.x1, fp.z1);
    const sel = it.id === selectedId;
    const cat = CATALOG[it.type];
    const color = sel ? "#f59e0b" : cat.wallMounted ? "#8b5cf6" : "#10b981";
    // The front edge, drawn heavy, shows which way the piece faces.
    const front: [number, number, number, number] =
      at.facing === "down" ? [x0, y1, x1, y1] : at.facing === "up" ? [x0, y0, x1, y0] : at.facing === "left" ? [x0, y0, x0, y1] : [x1, y0, x1, y1];
    return (
      <g key={it.id} data-kind="item" data-id={it.id} style={{ cursor: "move" }}>
        <rect
          x={x0}
          y={y0}
          width={x1 - x0}
          height={y1 - y0}
          fill={color}
          fillOpacity={cat.flat ? 0.06 * strength : (sel ? 0.34 : 0.2) * strength}
          stroke={color}
          strokeOpacity={Math.min(1, strength + 0.15)}
          strokeWidth={sel ? 2.5 : 1.5}
          strokeDasharray={cat.flat ? "5 4" : cat.wallMounted ? "3 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
        {!cat.flat && <line x1={front[0]} y1={front[1]} x2={front[2]} y2={front[3]} stroke={color} strokeOpacity={Math.min(1, strength + 0.15)} strokeWidth={sel ? 5 : 4} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
        {labels && (
          <text x={(x0 + x1) / 2} y={(y0 + y1) / 2} fontSize={fs * (sel ? 1.05 : 0.9)} textAnchor="middle" dominantBaseline="central" fill={sel ? "#92400e" : "#065f46"} stroke="#fff" strokeWidth={fs * 0.28} strokeOpacity={0.85} style={{ paintOrder: "stroke", pointerEvents: "none", fontWeight: 600 }}>
            {it.label ?? itemLabel(it.type)}
          </text>
        )}
      </g>
    );
  };

  const openingShape = (o: Opening, r: RoomModel, f: PlanFit) => {
    let op = o;
    if (drag?.kind === "opening" && drag.id === o.id) {
      const { wall, offset } = nearestWallAt(r, drag.x, drag.z);
      const L = wallLen(r, wall);
      op = { ...o, wall, offset: clamp(offset, o.width / 2 + 0.05, L - o.width / 2 - 0.05) };
    }
    const along = op.wall === "top" || op.wall === "bottom";
    const [cx, cz] = openingCentre(r, op);
    const a = toPlan(r, f, along ? cx - op.width / 2 : cx, along ? cz : cz - op.width / 2);
    const b = toPlan(r, f, along ? cx + op.width / 2 : cx, along ? cz : cz + op.width / 2);
    const c = OPENING_COLOR[op.kind];
    // The label sits inside the room, off the wall.
    const inward = fs * 1.1;
    const [tx, ty] = toPlan(r, f, cx, cz);
    const lx = op.wall === "left" ? tx + inward : op.wall === "right" ? tx - inward : tx;
    const ly = op.wall === "top" ? ty + inward : op.wall === "bottom" ? ty - inward : ty;
    return (
      <g key={op.id} data-kind="opening" data-id={op.id} style={{ cursor: along ? "ew-resize" : "ns-resize" }}>
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={22} vectorEffect="non-scaling-stroke" />
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={7} strokeOpacity={0.9} strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
        {labels && (
          <text x={lx} y={ly} fontSize={fs * 0.8} textAnchor="middle" dominantBaseline="central" fill={c} stroke="#fff" strokeWidth={fs * 0.25} style={{ paintOrder: "stroke", pointerEvents: "none", fontWeight: 700 }}>
            {op.main ? "main door" : op.kind === "opening" ? "opening" : op.kind}
          </text>
        )}
      </g>
    );
  };

  const draw = drag?.kind === "draw" ? drag : null;

  return (
    <div className="absolute inset-0 z-10 overflow-hidden rounded-2xl border border-white/10 bg-[#efece6]">
      <svg
        ref={svg}
        viewBox={vb.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full select-none"
        style={{ touchAction: "none", cursor: fit ? "default" : "crosshair" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label="Your plan with the 3D model drawn over it"
      >
        <image href={image.src} x={0} y={0} width={IW} height={IH} preserveAspectRatio="none" />
        {shown && box && (
          <>
            <rect x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} fill="#10b981" fillOpacity={0.04 * strength} stroke="#059669" strokeWidth={2} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
            {shown.items.filter((i) => CATALOG[i.type].flat).map((it) => itemShape(it, shown, shown.plan!))}
            {shown.items.filter((i) => !CATALOG[i.type].flat).map((it) => itemShape(it, shown, shown.plan!))}
            {shown.openings.map((o) => openingShape(o, shown, shown.plan!))}
            {labels && (
              <>
                <text x={(box[0] + box[2]) / 2} y={box[1] - fs * 1.5} fontSize={fs * 0.85} textAnchor="middle" fill="#047857" stroke="#fff" strokeWidth={fs * 0.25} style={{ paintOrder: "stroke", pointerEvents: "none", fontWeight: 600 }}>
                  {shown.width.toFixed(2)} m
                </text>
                <text x={box[0] - fs * 1.5} y={(box[1] + box[3]) / 2} fontSize={fs * 0.85} textAnchor="middle" fill="#047857" stroke="#fff" strokeWidth={fs * 0.25} transform={`rotate(-90 ${box[0] - fs * 1.5} ${(box[1] + box[3]) / 2})`} style={{ paintOrder: "stroke", pointerEvents: "none", fontWeight: 600 }}>
                  {shown.depth.toFixed(2)} m
                </text>
              </>
            )}
            {HANDLES.map((h) => {
              const [hx, hy] = h.at(box);
              const s = fs * 0.7;
              return <rect key={h.edges.join()} data-kind="handle" data-id={h.edges.map((v) => (v ? "1" : "0")).join("")} x={hx - s / 2} y={hy - s / 2} width={s} height={s} rx={s * 0.2} fill="#fff" stroke="#059669" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ cursor: h.cursor }} />;
            })}
          </>
        )}
        {draw && <rect x={Math.min(draw.p0[0], draw.p1[0])} y={Math.min(draw.p0[1], draw.p1[1])} width={Math.abs(draw.p1[0] - draw.p0[0])} height={Math.abs(draw.p1[1] - draw.p0[1])} fill="#10b981" fillOpacity={0.12} stroke="#059669" strokeWidth={2} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />}
      </svg>

      <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center">
        <div className="max-w-[92%] rounded-full bg-black/65 px-3 py-1 text-center text-[11px] leading-snug text-white">
          {fit
            ? "Your plan with the model drawn over it. Drag a piece, a door or window, or the dashed outline’s handles to match the drawing."
            : "Drag a box over the room’s inner wall lines to place the model on your plan."}
        </div>
      </div>
      {fit && (
        <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-white">
          <div className="flex items-center gap-2 rounded-full bg-black/65 px-3 py-1">
            <button type="button" onClick={() => setWhole((w) => !w)} className="underline-offset-2 hover:underline">
              {whole ? "Zoom to room" : "Whole sheet"}
            </button>
            <span className="text-white/30">|</span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
            </label>
            <span className="text-white/30">|</span>
            <label className="flex items-center gap-1.5">
              Model
              <input type="range" min={0.15} max={1} step={0.05} value={strength} onChange={(e) => setStrength(parseFloat(e.target.value))} className="h-1 w-20 accent-emerald-400" aria-label="Model overlay strength" />
            </label>
          </div>
          <div className="hidden items-center gap-2 rounded-full bg-black/65 px-3 py-1 sm:flex">
            <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> furniture</span>
            <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-violet-500" /> on the wall</span>
            <span className="flex items-center gap-1"><i className="inline-block h-1 w-3 bg-orange-500" /> door</span>
            <span className="flex items-center gap-1"><i className="inline-block h-1 w-3 bg-sky-500" /> window</span>
          </div>
        </div>
      )}
    </div>
  );
}
