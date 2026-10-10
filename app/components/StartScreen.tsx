"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomKind } from "@/lib/room/types";
import { ROOM_KINDS } from "@/lib/room/catalog";

interface Props {
  onFile: (file: File) => void;
  onSample: (id: string) => void;
  onBlank: (kind: RoomKind, width: number, depth: number) => void;
  savedName: string | null;
  onContinue: () => void;
  error: string | null;
  busy: boolean;
}

const STEPS = [
  ["Upload", "your room's plan — JPEG, PNG or PDF"],
  ["Exact 3D model", "true to the printed dimensions, built once"],
  ["Shots", "from the main door at eye level, from behind the bed or sofa, corners, top"],
  ["Edit by typing", "“add bed back”, “change side table design”, “delete that”"],
  ["Realistic", "Nano Banana turns any shot into a photo · or open it in Blender"],
];

/** Landing: upload a plan (or PDF), try a sample, or start from a blank room. */
export default function StartScreen({ onFile, onSample, onBlank, savedName, onContinue, error, busy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [kind, setKind] = useState<RoomKind>("bedroom");
  const [unit, setUnit] = useState<"ft" | "m">("ft");
  const [w, setW] = useState("12");
  const [d, setD] = useState("14");

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? [])[0];
      if (f) onFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  const blank = () => {
    const k = unit === "ft" ? 0.3048 : 1;
    const W = parseFloat(w) * k;
    const D = parseFloat(d) * k;
    if (W >= 1.2 && D >= 1.2 && W <= 20 && D <= 20) onBlank(kind, Math.round(W * 100) / 100, Math.round(D * 100) / 100);
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2 text-center sm:pt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          Your room plan, as an{" "}
          <span className="bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">exact 3D room</span>
        </h1>
        <p className="mx-auto max-w-2xl text-sm text-neutral-400 sm:text-base">
          We read the plan once, build a true-to-scale 3D model of the room, and shoot it like a photographer — from the main door at eye level, from behind the bed or the sofa. Change anything by typing. Turn any shot into a photo when you like it.
        </p>
      </section>

      <ol className="mx-auto grid max-w-5xl gap-2 sm:grid-cols-5">
        {STEPS.map(([t, d2], i) => (
          <li key={t} className="panel p-3">
            <div className="text-[11px] text-emerald-300/80">{i + 1}</div>
            <div className="text-sm font-medium">{t}</div>
            <div className="text-[11px] leading-snug text-neutral-500">{d2}</div>
          </li>
        ))}
      </ol>

      <div className="mx-auto max-w-3xl space-y-3">
        {savedName && (
          <button type="button" onClick={onContinue} className="panel flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-white/5">
            <span>
              Continue with <span className="font-medium">{savedName}</span>
            </span>
            <span className="text-emerald-300">Open →</span>
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className={`group flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-12 text-center transition ${
            over ? "border-emerald-400 bg-emerald-400/10" : "border-white/15 bg-white/[0.03] hover:border-emerald-500/70 hover:bg-white/[0.06]"
          }`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl">📐</span>
          <span className="text-lg font-medium">{busy ? "Opening…" : over ? "Drop it here" : "Drop your room plan here"}</span>
          <span className="text-sm text-neutral-400">or click to browse · JPEG, PNG or PDF · paste works too</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="panel space-y-2 p-4">
            <div className="eyebrow">No plan handy?</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onSample("bedroom")} className="btn-outline min-h-0 px-3 py-2 text-sm">
                Sample bedroom 12′×14′
              </button>
              <button type="button" onClick={() => onSample("living")} className="btn-outline min-h-0 px-3 py-2 text-sm">
                Sample living 4.5×5.5 m
              </button>
            </div>
          </div>
          <form
            className="panel space-y-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              blank();
            }}
          >
            <div className="eyebrow">Start from the room size</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={kind} onChange={(e) => setKind(e.target.value as RoomKind)} className="input w-auto px-2 py-1.5">
                {ROOM_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input value={w} onChange={(e) => setW(e.target.value)} className="input w-16 px-2 py-1.5" inputMode="decimal" aria-label="Width" />
              ×
              <input value={d} onChange={(e) => setD(e.target.value)} className="input w-16 px-2 py-1.5" inputMode="decimal" aria-label="Depth" />
              <select value={unit} onChange={(e) => setUnit(e.target.value as "ft" | "m")} className="input w-auto px-2 py-1.5">
                <option value="ft">ft</option>
                <option value="m">m</option>
              </select>
              <button type="submit" className="btn-secondary min-h-0 px-3 py-1.5">
                Build
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
