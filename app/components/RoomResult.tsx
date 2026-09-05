"use client";

import DownloadButton from "./DownloadButton";
import DetectionOverlay from "./DetectionOverlay";
import type { LayoutLock, RoomVersion } from "../PlanToThreeD";
import type { SpatialBox } from "@/lib/spatial";

interface Props {
  cropDataUrl: string | null;
  /** Detected boxes, drawn over the crop so a wrong render can be traced to its stage. */
  boxes: SpatialBox[];
  /** The clay massing the render was locked to. */
  blockoutDataUrl: string | null;
  layoutLock: LayoutLock;
  /** Every render of this room; each carries its own layout check. */
  versions: RoomVersion[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  onRegenerate: () => void;
  onEditPrompt: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPickAnother: () => void;
}

/** Step 5/6: show the room render, regenerate, and flip through versions. */
export default function RoomResult({
  cropDataUrl,
  boxes,
  blockoutDataUrl,
  layoutLock,
  versions,
  currentIndex,
  loading,
  error,
  onRegenerate,
  onEditPrompt,
  onPrev,
  onNext,
  onPickAnother,
}: Props) {
  const current = versions[currentIndex] ?? null;
  const hasMultiple = versions.length > 1;
  // The check belongs to the version being VIEWED, not the latest render.
  const verification = current?.verification ?? null;
  const problemText = verification && !verification.matches ? verification.problems.join("; ") : "";

  return (
    <div className="card space-y-5 p-4">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <figure className="space-y-3">
          <div className="space-y-2">
            <figcaption className="eyebrow">1 · Plan crop {boxes.length > 0 && "+ detected layout"}</figcaption>
            {cropDataUrl ? (
              <div className="media-frame bg-white">
                <DetectionOverlay cropDataUrl={cropDataUrl} boxes={boxes} />
              </div>
            ) : null}
          </div>
          {blockoutDataUrl && (
            <div className="space-y-2">
              <figcaption className="eyebrow">2 · Clay massing the render is locked to</figcaption>
              <div className="media-frame bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={blockoutDataUrl}
                  alt="Eye-level clay massing model built from the detected layout"
                  className="block w-full"
                />
              </div>
              <p className="text-xs text-neutral-500">
                Compare top to bottom: if the massing already differs from the plan, the fault is
                detection; if the render differs from the massing, it is the renderer.
              </p>
            </div>
          )}
        </figure>

        <figure className="space-y-2">
          <figcaption className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="eyebrow">3 · Photorealistic interior</span>
              {current &&
                (layoutLock.status === "locked" ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                    Layout-locked
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                    Prompt-only
                  </span>
                ))}
              {verification?.matches === true && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                  Verified ✓
                </span>
              )}
              {verification?.matches === false && (
                <span
                  className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
                  title="The automatic layout check still found mismatches after a retry — compare against the crop and Regenerate if needed."
                >
                  Check failed
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {versions.length > 0 && (
                <span className="text-xs text-neutral-400">
                  version {currentIndex + 1} / {versions.length}
                </span>
              )}
              {current && (
                <DownloadButton
                  url={current.url}
                  filename={`voxa-room-v${currentIndex + 1}.png`}
                />
              )}
            </div>
          </figcaption>
          {problemText && (
            <p className="text-xs leading-relaxed text-amber-200/80">
              <span className="font-medium text-amber-300">Layout check: </span>
              {problemText}
            </p>
          )}
          <div className="media-frame flex min-h-[16rem] items-center justify-center">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.url}
                alt="Generated photorealistic interior render of the room"
                className="block max-h-[68vh] w-auto max-w-full"
              />
            ) : (
              <span className="px-4 py-8 text-center text-sm text-neutral-500">
                {loading ? "Building room…" : "No render yet."}
              </span>
            )}
          </div>
        </figure>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRegenerate} disabled={loading} className="btn-primary">
          {loading ? "Regenerating…" : "Regenerate"}
        </button>

        <button type="button" onClick={onEditPrompt} disabled={loading} className="btn-outline">
          Edit prompt
        </button>

        {hasMultiple && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={currentIndex === 0}
              className="btn-outline px-3"
              aria-label="Previous version"
            >
              ←
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={currentIndex === versions.length - 1}
              className="btn-outline px-3"
              aria-label="Next version"
            >
              →
            </button>
          </div>
        )}

        <button type="button" onClick={onPickAnother} disabled={loading} className="btn-outline ml-auto">
          Pick another room
        </button>
      </div>
    </div>
  );
}
