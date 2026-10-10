"use client";

import { useRef, useState } from "react";
import type { RoomKind } from "@/lib/room/types";
import { ROOM_KINDS } from "@/lib/room/catalog";
import type { PlanImage } from "@/lib/planFile";

interface Props {
  plan: PlanImage;
  busy: string | null;
  error: string | null;
  aiReady: boolean;
  aiName: string;
  onRead: (opts: { kind: RoomKind | null; hint: string; crop: { x: number; y: number; w: number; h: number } | null }) => void;
  onPage: (page: number) => void;
  onManual: (kind: RoomKind) => void;
  onBack: () => void;
}

/**
 * The uploaded plan, before it is read. If the drawing has several rooms the
 * user draws a box around the one to model; a room type and a hint can steer
 * the reading. One click reads it into the 3D model.
 */
export default function PlanStep({ plan, busy, error, aiReady, aiName, onRead, onPage, onManual, onBack }: Props) {
  const img = useRef<HTMLImageElement>(null);
  const [kind, setKind] = useState<RoomKind | "auto">("auto");
  const [hint, setHint] = useState("");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [drawing, setDrawing] = useState(false);

  const local = (e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
  };
  const shown = drag ?? box;
  const norm = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), w: Math.abs(b.x1 - b.x0), h: Math.abs(b.y1 - b.y0) });

  const read = () => {
    let crop: { x: number; y: number; w: number; h: number } | null = null;
    if (box && img.current) {
      const r = img.current.getBoundingClientRect();
      const n = norm(box);
      const k = plan.width / r.width;
      if (n.w > 20 && n.h > 20) crop = { x: n.x * k, y: n.y * k, w: n.w * k, h: n.h * k };
    }
    onRead({ kind: kind === "auto" ? null : kind, hint, crop });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-2">
        <div className="relative flex select-none justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
          <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={img}
            src={plan.src}
            alt="Your plan"
            draggable={false}
            className={`block h-auto max-h-[70vh] w-auto max-w-full ${drawing ? "cursor-crosshair" : ""}`}
            onPointerDown={(e) => {
              if (!drawing) return;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              const p = local(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const p = local(e);
              setDrag({ ...drag, x1: p.x, y1: p.y });
            }}
            onPointerUp={() => {
              if (drag) {
                const n = norm(drag);
                setBox(n.w > 12 && n.h > 12 ? drag : null);
                setDrag(null);
                setDrawing(false);
              }
            }}
          />
          {shown && (
            <div
              className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-400/10"
              style={{ left: norm(shown).x, top: norm(shown).y, width: norm(shown).w, height: norm(shown).h }}
            />
          )}
          </div>
          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-sm text-white">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {busy}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span className="truncate">{plan.name}</span>
          {plan.pages && plan.pages > 1 && (
            <span className="flex items-center gap-1">
              · page
              <select value={plan.page ?? 1} onChange={(e) => onPage(Number(e.target.value))} className="input w-auto px-2 py-1 text-xs">
                {Array.from({ length: plan.pages }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
              of {plan.pages}
            </span>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel space-y-3 p-4">
          <div className="eyebrow">1 · Which room?</div>
          <p className="text-xs leading-relaxed text-neutral-400">If the plan shows several rooms, draw a box around the one to model. A plan of one room needs nothing.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDrawing(true)} className={`btn-outline min-h-0 px-3 py-1.5 text-xs ${drawing ? "ring-1 ring-emerald-400" : ""}`}>
              {drawing ? "Drag on the plan…" : box ? "Redraw box" : "Draw a box"}
            </button>
            {box && (
              <button type="button" onClick={() => setBox(null)} className="btn-ghost text-xs">
                Clear
              </button>
            )}
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
            Room type
            <select value={kind} onChange={(e) => setKind(e.target.value as RoomKind | "auto")} className="input px-2 py-1.5 text-sm">
              <option value="auto">Detect from the plan</option>
              {ROOM_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
            Anything to know? (optional)
            <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. the master bedroom, top right" className="input px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="panel space-y-3 p-4">
          <div className="eyebrow">2 · Build the 3D model</div>
          <button type="button" onClick={read} disabled={!!busy || !aiReady} className="btn-primary w-full">
            {busy ? "Reading…" : "Read plan & build 3D"}
          </button>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {aiReady
              ? `${aiName} reads the walls, printed dimensions, doors, windows and furniture symbols once. Everything after that is exact geometry — no AI drawing.`
              : "Add a Google AI Studio (Gemini) or kie.ai key at the bottom of the page so the plan can be read."}
          </p>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button type="button" onClick={() => onManual(kind === "auto" ? "bedroom" : kind)} className="btn-ghost text-xs">
            Skip the AI — I’ll enter the size myself
          </button>
        </div>
        <button type="button" onClick={onBack} className="btn-ghost text-xs">
          ← Choose another plan
        </button>
      </aside>
    </div>
  );
}
