"use client";

import { useEffect, useState } from "react";
import type { Dir, Item, ItemType, RoomModel } from "@/lib/room/types";
import { CATALOG, ITEM_TYPES, itemLabel } from "@/lib/room/catalog";
import { variantLabel, type Op } from "@/lib/room/commands";

interface Props {
  room: RoomModel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onApply: (ops: Op[]) => void;
  onFurnish: () => void;
}

const FINISHES = [
  "walnut",
  "oak",
  "white oak",
  "teak",
  "wenge",
  "white",
  "beige",
  "light grey",
  "charcoal",
  "black",
  "sage green",
  "emerald velvet",
  "navy velvet",
  "mustard velvet",
  "terracotta",
  "tan leather",
  "cane",
  "white marble",
  "black marble",
  "brass",
];

const FACINGS: { v: Dir; label: string }[] = [
  { v: "up", label: "↑ top wall" },
  { v: "down", label: "↓ bottom wall" },
  { v: "left", label: "← left wall" },
  { v: "right", label: "→ right wall" },
];

function NumberField({ label, value, onCommit, step = 0.01, min = 0 }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= min && Math.abs(n - value) > 1e-4) onCommit(n);
    else setV(String(value));
  };
  return (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="input px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function name(it: Item): string {
  return it.label ?? itemLabel(it.type);
}

/** Every piece in the room, and an editor for the selected one. */
export default function ElementsPanel({ room, selectedId, onSelect, onApply, onFurnish }: Props) {
  const sel = room.items.find((i) => i.id === selectedId) ?? null;
  const [addType, setAddType] = useState<ItemType>("bedBack");
  const [finish, setFinish] = useState("");
  useEffect(() => setFinish(sel?.finish ?? ""), [sel?.id, sel?.finish]);
  const upd = (patch: Omit<Extract<Op, { op: "update" }>, "op" | "ids">) => sel && onApply([{ op: "update", ids: [sel.id], ...patch }]);
  const furniture = room.items.filter((i) => !CATALOG[i.type].flat).length;

  return (
    <div className="space-y-4">
      {sel && (
        <div className="panel space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="eyebrow">Selected</div>
              <div className="text-sm font-medium capitalize">{name(sel)}</div>
            </div>
            <button type="button" onClick={() => onSelect(null)} className="btn-ghost text-xs">
              Done
            </button>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
            Design
            <select value={sel.variant} onChange={(e) => upd({ variant: e.target.value })} className="input py-2 text-sm">
              {CATALOG[sel.type].variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1.5">
            <div className="text-[11px] text-neutral-400">Finish {sel.finish ? <span className="text-neutral-300">· {sel.finish}</span> : <span>· room style</span>}</div>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => upd({ finish: null })} className={`rounded-full border px-2 py-0.5 text-[11px] ${!sel.finish ? "border-emerald-400/60 text-emerald-200" : "border-white/10 text-neutral-400 hover:text-white"}`}>
                style default
              </button>
              {FINISHES.map((f) => (
                <button key={f} type="button" onClick={() => upd({ finish: f })} className={`rounded-full border px-2 py-0.5 text-[11px] ${sel.finish === f ? "border-emerald-400/60 text-emerald-200" : "border-white/10 text-neutral-400 hover:text-white"}`}>
                  {f}
                </button>
              ))}
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (finish.trim()) upd({ finish: finish.trim() });
              }}
            >
              <input value={finish} onChange={(e) => setFinish(e.target.value)} placeholder="or type: dusty pink velvet, #a0b0c0…" className="input px-2 py-1.5 text-xs" />
              <button type="submit" className="btn-outline min-h-0 px-3 py-1 text-xs">
                Set
              </button>
            </form>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Width (m)" value={sel.w} onCommit={(v) => upd({ w: v })} />
            <NumberField label="Depth (m)" value={sel.d} onCommit={(v) => upd({ d: v })} />
            <NumberField label="Height (m)" value={sel.h} onCommit={(v) => upd({ h: v })} />
            <NumberField label="x (m)" value={sel.x} onCommit={(v) => upd({ x: v })} min={-1} />
            <NumberField label="z (m)" value={sel.z} onCommit={(v) => upd({ z: v })} min={-1} />
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              Front faces
              <select value={sel.facing} onChange={(e) => upd({ facing: e.target.value as Dir })} className="input px-2 py-1.5 text-sm">
                {FACINGS.map((f) => (
                  <option key={f.v} value={f.v}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => upd({ rotate: 90 })} className="btn-outline min-h-0 px-3 py-1.5 text-xs">
              ⟳ Rotate 90°
            </button>
            {(["left", "right", "up", "down"] as const).map((d) => (
              <button key={d} type="button" title={`Move 10 cm ${d}`} onClick={() => upd(d === "left" ? { dx: -0.1 } : d === "right" ? { dx: 0.1 } : d === "up" ? { dz: -0.1 } : { dz: 0.1 })} className="btn-outline min-h-0 px-2.5 py-1.5 text-xs">
                {d === "left" ? "←" : d === "right" ? "→" : d === "up" ? "↑" : "↓"}
              </button>
            ))}
            <button type="button" onClick={() => sel && onApply([{ op: "remove", ids: [sel.id] }])} className="ml-auto min-h-0 rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10">
              Delete
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500">Tip: drag the selected piece in the 3D view to move it. Positions are plan metres from the top-left inside corner.</p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Elements ({room.items.length})</span>
          {furniture < 2 && (
            <button type="button" onClick={onFurnish} className="btn-secondary min-h-0 px-3 py-1 text-xs">
              Furnish it for me
            </button>
          )}
        </div>
        <ul className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
          {room.items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onSelect(it.id === selectedId ? null : it.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${it.id === selectedId ? "bg-emerald-400/15 text-emerald-100" : "hover:bg-white/5"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate capitalize">{name(it)}</span>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {variantLabel(it)}
                    {it.finish ? ` · ${it.finish}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                  {it.w.toFixed(2)}×{it.d.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
          {!room.items.length && <li className="px-3 py-2 text-xs text-neutral-500">No furniture yet — add some below, type a command, or let the app furnish it.</li>}
        </ul>
      </div>

      <div className="flex gap-2">
        <select value={addType} onChange={(e) => setAddType(e.target.value as ItemType)} className="input flex-1 py-2 text-sm" aria-label="Element to add">
          {ITEM_TYPES.filter((t) => t !== "other").map((t) => (
            <option key={t} value={t}>
              {itemLabel(t)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onApply([{ op: "add", type: addType }])} className="btn-outline min-h-0 px-4 py-2 text-sm">
          + Add
        </button>
      </div>
    </div>
  );
}
