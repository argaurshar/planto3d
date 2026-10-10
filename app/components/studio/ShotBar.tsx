"use client";

import type { Shot } from "@/lib/room/types";

interface Props {
  shots: Shot[];
  activeId: string | null;
  busy: boolean;
  onPick: (s: Shot) => void;
  onCapture: () => void;
}

function icon(id: string): string {
  if (id === "entry") return "🚪";
  if (id === "back") return "🛏";
  if (id === "front") return "🎯";
  if (id === "top") return "🗺";
  return "📐";
}

/** The preset camera positions, and the button that captures the current one. */
export default function ShotBar({ shots, activeId, busy, onPick, onCapture }: Props) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex flex-1 flex-wrap gap-1.5">
        {shots.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.note}
            onClick={() => onPick(s)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              activeId === s.id
                ? "border-transparent bg-emerald-400/20 text-emerald-100 ring-1 ring-emerald-400/50"
                : "border-white/10 text-neutral-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span aria-hidden="true" className="mr-1">
              {icon(s.id)}
            </span>
            {s.label}
          </button>
        ))}
        {!activeId && <span className="self-center px-2 text-xs text-neutral-500">Free view — drag to orbit, scroll to zoom</span>}
      </div>
      <button type="button" onClick={onCapture} disabled={busy} className="btn-primary shrink-0 px-4 py-2 text-sm">
        {busy ? "Rendering…" : "📸 Take this shot"}
      </button>
    </div>
  );
}
