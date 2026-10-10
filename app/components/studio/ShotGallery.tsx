"use client";

import { useState } from "react";
import type { RoomModel, Shot } from "@/lib/room/types";
import CompareSlider from "../CompareSlider";
import DownloadButton from "../DownloadButton";

export interface ShotRecord {
  id: string;
  label: string;
  shot: Shot;
  /** The raw (semi-rendered) shot of the 3D model, PNG data URL. */
  raw: string;
  /** Model version the shot was taken of, and the model itself (for the realistic prompt). */
  version: number;
  room: RoomModel;
  createdAt: number;
  real?: string;
  realBusy?: boolean;
  realError?: string;
}

interface Props {
  shots: ShotRecord[];
  version: number;
  aiReady: boolean;
  aiName: string;
  onRealistic: (id: string, extra: string) => void;
  onRemove: (id: string) => void;
  onRetake: (id: string) => void;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function Card({ r, version, aiReady, aiName, onRealistic, onRemove, onRetake }: { r: ShotRecord } & Omit<Props, "shots">) {
  const [extra, setExtra] = useState("");
  const outdated = r.version !== version;
  return (
    <figure className="card overflow-hidden">
      <div className="relative">
        {r.real ? (
          <CompareSlider beforeSrc={r.raw} afterSrc={r.real} beforeLabel="3D model" afterLabel="Realistic" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.raw} alt={r.label} className="block aspect-[4/3] w-full object-cover" />
        )}
        {r.realBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-sm text-white">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Making it photoreal with {aiName}… (up to a minute or two)
          </div>
        )}
      </div>
      <figcaption className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{r.label}</div>
            <div className="text-[11px] text-neutral-500">
              {r.real ? "Raw 3D shot ↔ realistic render — drag to compare" : "Raw shot of the exact 3D model"}
              {outdated && <span className="text-amber-300/90"> · the model has changed since</span>}
            </div>
          </div>
          <button type="button" onClick={() => onRemove(r.id)} className="btn-ghost text-xs" aria-label="Remove shot">
            ✕
          </button>
        </div>
        {r.realError && <p className="text-xs text-red-300">{r.realError}</p>}
        {!r.real && (
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Optional: evening light, warm lamps on…" className="input px-2 py-1.5 text-xs" disabled={r.realBusy} />
        )}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={r.realBusy || !aiReady} onClick={() => onRealistic(r.id, extra)} className="btn-secondary min-h-0 px-3 py-1.5 text-xs" title={aiReady ? "" : "Add an AI key at the bottom of the page"}>
            {r.real ? "↻ Realistic again" : "✨ Make realistic"}
          </button>
          {outdated && (
            <button type="button" onClick={() => onRetake(r.id)} className="btn-outline min-h-0 px-3 py-1.5 text-xs">
              Retake with changes
            </button>
          )}
          <DownloadButton url={r.raw} filename={`${slug(r.label)}-3d.png`} label="3D shot" className="btn-outline min-h-0 px-3 py-1.5 text-xs" />
          {r.real && <DownloadButton url={r.real} filename={`${slug(r.label)}-realistic.png`} label="Realistic" className="btn-outline min-h-0 px-3 py-1.5 text-xs" />}
        </div>
      </figcaption>
    </figure>
  );
}

/** Captured shots: raw 3D frames, each with an optional realistic version. */
export default function ShotGallery(props: Props) {
  if (!props.shots.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Shots</h2>
        <span className="text-xs text-neutral-500">Raw shots are free and instant. “Make realistic” sends the shot to {props.aiName}.</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[...props.shots].reverse().map((r) => (
          <Card key={r.id} r={r} {...props} />
        ))}
      </div>
    </section>
  );
}
