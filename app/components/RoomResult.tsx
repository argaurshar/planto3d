"use client";

import DownloadButton from "./DownloadButton";
import type { LayoutLock } from "../PlanToThreeD";

interface Props {
  cropDataUrl: string | null;
  layoutLock: LayoutLock;
  versions: string[];
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

  return (
    <div className="card space-y-5 p-4">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <figure className="space-y-2">
          <figcaption className="eyebrow">Selected room</figcaption>
          {cropDataUrl ? (
            <div className="media-frame bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cropDataUrl} alt="Selected room crop from the plan" className="block w-full" />
            </div>
          ) : null}
        </figure>

        <figure className="space-y-2">
          <figcaption className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Photorealistic interior</span>
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
            </div>
            <div className="flex items-center gap-3">
              {versions.length > 0 && (
                <span className="text-xs text-neutral-400">
                  version {currentIndex + 1} / {versions.length}
                </span>
              )}
              {current && (
                <DownloadButton
                  url={current}
                  filename={`voxa-room-v${currentIndex + 1}.png`}
                />
              )}
            </div>
          </figcaption>
          <div className="media-frame flex min-h-[16rem] items-center justify-center">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current}
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
