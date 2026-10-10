"use client";

import { useState } from "react";
import type { RoomModel, Shot } from "@/lib/room/types";
import { QUALITIES, type Quality } from "@/lib/room/renderServer";
import CompareSlider from "../CompareSlider";
import DownloadButton from "../DownloadButton";

export interface ShotRecord {
  id: string;
  label: string;
  shot: Shot;
  /** The raw (semi-rendered) shot of the 3D model, PNG data URL. */
  raw: string;
  /** Model version the shot was taken of, and the model itself (for renders). */
  version: number;
  room: RoomModel;
  createdAt: number;
  /** AI "make realistic" result. */
  real?: string;
  realBusy?: boolean;
  realError?: string;
  /** Real Blender Cycles render from the render server. */
  cycles?: string;
  cyclesQuality?: Quality;
  cyclesStatus?: string;
  cyclesError?: string;
}

interface Props {
  shots: ShotRecord[];
  version: number;
  aiReady: boolean;
  aiName: string;
  blenderReady: boolean;
  onRealistic: (id: string, extra: string) => void;
  onBlender: (id: string, quality: Quality) => void;
  onRemove: (id: string) => void;
  onRetake: (id: string) => void;
}

/** File extension for a data URL or remote image (Nano Banana often returns JPEG). */
function ext(url: string): string {
  const m = url.match(/^data:image\/(png|jpe?g|webp)/);
  return m ? (m[1] === "jpeg" ? "jpg" : m[1]) : /\.jpe?g(\?|$)/i.test(url) ? "jpg" : "png";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function Busy({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 px-6 text-center text-sm text-white">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      {text}
    </div>
  );
}

function Card({ r, version, aiReady, aiName, blenderReady, onRealistic, onBlender, onRemove, onRetake }: { r: ShotRecord } & Omit<Props, "shots">) {
  const [extra, setExtra] = useState("");
  const [quality, setQuality] = useState<Quality>("draft");
  const [view, setView] = useState<"real" | "cycles" | null>(null);
  const outdated = r.version !== version;
  // Show the newest finished render unless the user picked one.
  const shown = view && r[view] ? view : r.cycles ? "cycles" : r.real ? "real" : null;
  const after = shown ? r[shown] : undefined;
  return (
    <figure className="card overflow-hidden">
      <div className="relative">
        {after ? (
          <CompareSlider key={shown} beforeSrc={r.raw} afterSrc={after} beforeLabel="3D model" afterLabel={shown === "cycles" ? "Blender Cycles" : "Realistic (AI)"} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.raw} alt={r.label} className="block aspect-[4/3] w-full object-cover" />
        )}
        {r.realBusy && <Busy text={`Making it photoreal with ${aiName}… (up to a minute or two)`} />}
        {r.cyclesStatus && !r.realBusy && <Busy text={r.cyclesStatus} />}
      </div>
      <figcaption className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{r.label}</div>
            <div className="text-[11px] text-neutral-500">
              {after ? "Drag to compare with the raw 3D shot" : "Raw shot of the exact 3D model"}
              {outdated && <span className="text-amber-300/90"> · the model has changed since</span>}
            </div>
          </div>
          <button type="button" onClick={() => onRemove(r.id)} className="btn-ghost text-xs" aria-label="Remove shot">
            ✕
          </button>
        </div>
        {r.real && r.cycles && (
          <div className="flex gap-1 rounded-full bg-white/5 p-1 text-[11px]">
            {(["cycles", "real"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`flex-1 rounded-full px-2 py-1 ${shown === v ? "bg-emerald-400/20 text-emerald-100" : "text-neutral-400 hover:text-white"}`}>
                {v === "cycles" ? "Blender Cycles" : "Realistic (AI)"}
              </button>
            ))}
          </div>
        )}
        {r.realError && <p className="text-xs text-red-300">{r.realError}</p>}
        {r.cyclesError && <p className="text-xs text-red-300">{r.cyclesError}</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} disabled={!blenderReady || !!r.cyclesStatus} className="input w-auto px-2 py-1 text-xs" aria-label="Blender render quality" title={QUALITIES[quality].note}>
            {(Object.keys(QUALITIES) as Quality[]).map((q) => (
              <option key={q} value={q}>
                {QUALITIES[q].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!blenderReady || !!r.cyclesStatus}
            onClick={() => onBlender(r.id, quality)}
            className="btn-secondary min-h-0 px-3 py-1.5 text-xs"
            title={blenderReady ? "Render this exact camera with Blender Cycles on your render server" : "Connect a Blender render server at the bottom of the page"}
          >
            {r.cycles ? "↻ Render in Blender again" : "🎬 Render in Blender"}
          </button>
        </div>

        {!r.real && <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Optional for AI: evening light, warm lamps on…" className="input px-2 py-1.5 text-xs" disabled={r.realBusy} />}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={r.realBusy || !aiReady} onClick={() => onRealistic(r.id, extra)} className="btn-outline min-h-0 px-3 py-1.5 text-xs" title={aiReady ? "" : "Add an AI key at the bottom of the page"}>
            {r.real ? "↻ Realistic again (AI)" : "✨ Make realistic (AI)"}
          </button>
          {outdated && (
            <button type="button" onClick={() => onRetake(r.id)} className="btn-outline min-h-0 px-3 py-1.5 text-xs">
              Retake with changes
            </button>
          )}
          <DownloadButton url={r.raw} filename={`${slug(r.label)}-3d.png`} label="3D shot" className="btn-outline min-h-0 px-3 py-1.5 text-xs" />
          {r.cycles && <DownloadButton url={r.cycles} filename={`${slug(r.label)}-blender.png`} label="Blender" className="btn-outline min-h-0 px-3 py-1.5 text-xs" />}
          {r.real && <DownloadButton url={r.real} filename={`${slug(r.label)}-realistic.${ext(r.real)}`} label="Realistic" className="btn-outline min-h-0 px-3 py-1.5 text-xs" />}
        </div>
      </figcaption>
    </figure>
  );
}

/** Captured shots: raw 3D frames, each with optional Blender and AI renders. */
export default function ShotGallery(props: Props) {
  if (!props.shots.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Shots</h2>
        <span className="text-xs text-neutral-500">
          Raw shots are instant. “Render in Blender” runs real Cycles on your render server; “Make realistic” sends the shot to {props.aiName}.
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[...props.shots].reverse().map((r) => (
          <Card key={r.id} r={r} {...props} />
        ))}
      </div>
    </section>
  );
}
