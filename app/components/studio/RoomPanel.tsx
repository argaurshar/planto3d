"use client";

import { useEffect, useState } from "react";
import type { FloorFinish, Opening, OpeningKind, RoomKind, RoomModel, StyleId, Wall } from "@/lib/room/types";
import { ROOM_KINDS } from "@/lib/room/catalog";
import { STYLES, STYLE_IDS } from "@/lib/room/styles";
import { formatSize, round2 } from "@/lib/room/geometry";

interface Props {
  room: RoomModel;
  onChange: (room: RoomModel) => void;
}

const WALL_COLORS = ["#ece6dc", "#f2f0eb", "#e9e1d3", "#d8cdbb", "#c9cbbf", "#b9c4b4", "#a8b4be", "#d9c2b4", "#8e9a86", "#5f6b73"];

function Num({ label, value, onCommit, step = 0.01 }: { label: string; value: number; onCommit: (v: number) => void; step?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0 && Math.abs(n - value) > 1e-4) onCommit(round2(n));
    else setV(String(value));
  };
  return (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
      {label}
      <input type="number" step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="input px-2 py-1.5 text-sm" />
    </label>
  );
}

function wallLen(room: RoomModel, w: Wall): number {
  return w === "top" || w === "bottom" ? room.width : room.depth;
}

/** The room itself: size, style, wall colour, floor, ceiling, curtains, doors and windows. */
export default function RoomPanel({ room, onChange }: Props) {
  const set = (patch: Partial<RoomModel>) => onChange({ ...room, ...patch });
  const setOpening = (id: string, patch: Partial<Opening>) => {
    const openings = room.openings.map((o) => {
      if (o.id !== id) return patch.main ? { ...o, main: false } : o;
      const n = { ...o, ...patch };
      if (patch.kind) {
        n.height = patch.kind === "window" ? 1.35 : 2.1;
        n.sill = patch.kind === "window" ? 0.9 : 0;
      }
      const L = wallLen(room, n.wall);
      n.width = Math.min(n.width, L - 0.1);
      n.offset = Math.max(n.width / 2, Math.min(L - n.width / 2, n.offset));
      return n;
    });
    onChange({ ...room, openings });
  };
  const addOpening = (kind: OpeningKind) => {
    const used = new Set(room.openings.map((o) => o.id));
    let n = 1;
    while (used.has(`${kind[0]}${n}`)) n++;
    const wall: Wall = kind === "window" ? "top" : "bottom";
    const width = kind === "window" ? 1.2 : 0.9;
    onChange({
      ...room,
      openings: [...room.openings, { id: `${kind[0]}${n}`, kind, wall, offset: round2(wallLen(room, wall) / 2), width, height: kind === "window" ? 1.35 : 2.1, sill: kind === "window" ? 0.9 : 0, main: kind === "door" && !room.openings.some((o) => o.main) }],
    });
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 flex flex-col gap-1 text-[11px] text-neutral-400">
          Name
          <input value={room.name} onChange={(e) => set({ name: e.target.value.slice(0, 60) })} className="input px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
          Room type
          <select value={room.kind} onChange={(e) => set({ kind: e.target.value as RoomKind })} className="input px-2 py-1.5 text-sm">
            {ROOM_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
          Style
          <select value={room.style} onChange={(e) => set({ style: e.target.value as StyleId, wallColor: STYLES[e.target.value as StyleId].wall })} className="input px-2 py-1.5 text-sm">
            {STYLE_IDS.map((s) => (
              <option key={s} value={s}>
                {STYLES[s].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div className="eyebrow mb-1.5">Size (inside the walls)</div>
        <div className="grid grid-cols-3 gap-2">
          <Num label="Width ← → (m)" value={room.width} onCommit={(v) => set({ width: Math.max(1.2, Math.min(20, v)) })} />
          <Num label="Depth ↑ ↓ (m)" value={room.depth} onCommit={(v) => set({ depth: Math.max(1.2, Math.min(20, v)) })} />
          <Num label="Ceiling (m)" value={room.height} onCommit={(v) => set({ height: Math.max(2.4, Math.min(6, v)) })} />
        </div>
        <p className="mt-1.5 text-[11px] text-neutral-500">
          {formatSize(room.width, room.depth)}
          {room.scaleSource === "printed" ? " · from the plan's printed dimensions" : room.scaleSource === "estimated" ? " · estimated — please check" : ""}
        </p>
      </div>

      <div>
        <div className="eyebrow mb-1.5">Walls</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {WALL_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => set({ wallColor: c })} title={c} className={`h-7 w-7 rounded-full border ${room.wallColor === c ? "ring-2 ring-emerald-400" : "border-white/20"}`} style={{ background: c }} />
          ))}
          <input type="color" value={room.wallColor} onChange={(e) => set({ wallColor: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-white/20 bg-transparent" aria-label="Custom wall colour" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
          Floor
          <select value={room.floor} onChange={(e) => set({ floor: e.target.value as FloorFinish })} className="input px-2 py-1.5 text-sm">
            <option value="wood">Wood planks</option>
            <option value="tile">Large tiles</option>
            <option value="marble">Marble</option>
            <option value="carpet">Carpet</option>
          </select>
        </label>
        <div className="flex flex-col justify-end gap-1.5 text-xs text-neutral-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={room.falseCeiling} onChange={(e) => set({ falseCeiling: e.target.checked })} /> False ceiling + cove light
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={room.curtains} onChange={(e) => set({ curtains: e.target.checked })} /> Curtains
          </label>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="eyebrow">Doors & windows</span>
          <span className="flex gap-1">
            <button type="button" onClick={() => addOpening("door")} className="btn-ghost text-xs">
              + door
            </button>
            <button type="button" onClick={() => addOpening("window")} className="btn-ghost text-xs">
              + window
            </button>
          </span>
        </div>
        <ul className="space-y-2">
          {room.openings.map((o) => (
            <li key={o.id} className="panel space-y-2 p-2">
              <div className="grid grid-cols-3 gap-1.5">
                <select value={o.kind} onChange={(e) => setOpening(o.id, { kind: e.target.value as OpeningKind })} className="input px-1.5 py-1 text-xs">
                  <option value="door">Door</option>
                  <option value="window">Window</option>
                  <option value="sliding">Sliding door</option>
                  <option value="opening">Open arch</option>
                </select>
                <select value={o.wall} onChange={(e) => setOpening(o.id, { wall: e.target.value as Wall })} className="input px-1.5 py-1 text-xs">
                  <option value="top">Top wall</option>
                  <option value="bottom">Bottom wall</option>
                  <option value="left">Left wall</option>
                  <option value="right">Right wall</option>
                </select>
                <button type="button" onClick={() => onChange({ ...room, openings: room.openings.filter((x) => x.id !== o.id) })} className="rounded-lg border border-red-400/30 px-2 text-xs text-red-300 hover:bg-red-400/10">
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-3 items-end gap-1.5">
                <Num label="Centre at (m)" value={o.offset} onCommit={(v) => setOpening(o.id, { offset: v })} />
                <Num label="Width (m)" value={o.width} onCommit={(v) => setOpening(o.id, { width: v })} />
                {o.kind === "door" || o.kind === "opening" ? (
                  <label className="flex items-center gap-1.5 pb-2 text-[11px] text-neutral-300">
                    <input type="radio" name="main-door" checked={!!o.main} onChange={() => setOpening(o.id, { main: true })} /> main door
                  </label>
                ) : (
                  <Num label="Sill (m)" value={o.sill} onCommit={(v) => setOpening(o.id, { sill: v })} />
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[11px] text-neutral-500">“Centre at” is measured from the left end of the top/bottom walls, and from the top end of the left/right walls, as on the plan.</p>
      </div>
    </div>
  );
}
