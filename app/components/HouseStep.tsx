"use client";

import type { DesignBrief as Brief } from "@/lib/types";
import { summarizeHouse, type HouseModel } from "@/lib/house";
import DesignBrief from "./DesignBrief";
import CompareSlider from "./CompareSlider";
import DownloadButton from "./DownloadButton";
import HouseView from "./HouseView";

export type HouseStatus = "idle" | "reading" | "ready" | "failed";

interface Props {
  planDataUrl: string;
  brief: Brief;
  house: HouseModel | null;
  houseStatus: HouseStatus;
  /** Our own axonometric clay render of the house (the overview's reference). */
  massingDataUrl: string | null;
  overviewDataUrl: string | null;
  overviewLoading: boolean;
  selectedRoom: number | null;
  error: string | null;
  onBriefChange: (patch: Partial<Brief>) => void;
  onSelectRoom: (index: number | null) => void;
  onRenderRoom: () => void;
  onRetryHouse: () => void;
  onGenerateOverview: () => void;
  onDrawBox: () => void;
  onReset: () => void;
}

/**
 * Step 1: the plan is read into ONE 3D model of the whole home — rooms, walls,
 * doors, windows, furniture — and the user picks a room inside it. The
 * styled AI overview is optional and, when made, is styled from this model.
 */
export default function HouseStep({
  planDataUrl,
  brief,
  house,
  houseStatus,
  massingDataUrl,
  overviewDataUrl,
  overviewLoading,
  selectedRoom,
  error,
  onBriefChange,
  onSelectRoom,
  onRenderRoom,
  onRetryHouse,
  onGenerateOverview,
  onDrawBox,
  onReset,
}: Props) {
  const busy = houseStatus === "reading" || overviewLoading;
  const selectedLabel = house && selectedRoom !== null ? house.rooms[selectedRoom]?.label : null;

  return (
    <div className="space-y-6">
      <DesignBrief brief={brief} disabled={busy} onChange={onBriefChange} />

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow">3D model of the whole home</span>
          {house && (
            <span className="text-xs text-neutral-500">
              {summarizeHouse(house)} · scale{" "}
              {house.sizeSource === "printed"
                ? `from the printed dimensions (${house.size.width.toFixed(1)} × ${house.size.depth.toFixed(1)} m)`
                : "estimated (no printed dimensions read)"}
            </span>
          )}
        </div>

        {houseStatus === "reading" && (
          <div className="relative mx-auto block w-fit max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={planDataUrl}
              alt="Uploaded 2D floor plan"
              className="block max-h-[60vh] w-auto max-w-full rounded-xl border border-white/10 bg-white"
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 p-4 text-center text-sm text-neutral-200 backdrop-blur-sm">
              Reading the plan — every room, wall, door, window and piece of furniture — and building the 3D model…
            </div>
          </div>
        )}

        {houseStatus === "failed" && (
          <div className="space-y-3">
            <p className="text-sm text-amber-400">
              The plan couldn&apos;t be read into a house model{error ? `: ${error}` : ""}. You can retry, or draw a
              box around a room on the plan instead (each room is then detected on its own).
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onRetryHouse} className="btn-secondary">
                Retry reading the plan
              </button>
              <button type="button" onClick={onDrawBox} className="btn-secondary">
                Draw a box on the plan
              </button>
            </div>
          </div>
        )}

        {houseStatus === "ready" && house && (
          <>
            <HouseView planDataUrl={planDataUrl} house={house} selected={selectedRoom} onSelect={onSelectRoom} />
            <p className="text-xs text-neutral-500">
              Blue rectangles are the detected rooms, amber the doors, purple the windows. The 3D model is built
              from them: every wall comes from the room boundaries, and the room you pick is rendered from inside
              this model, from the green camera at its door. Is a room missing or wrong? Draw a box on the plan
              instead.
            </p>
          </>
        )}

        {houseStatus === "ready" && house && error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {(massingDataUrl || overviewDataUrl) && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="eyebrow">{overviewDataUrl ? "Clay model ↔ styled overview — drag to compare" : "Axonometric clay model"}</span>
            {overviewDataUrl && <DownloadButton url={overviewDataUrl} filename="voxa-overview.png" />}
          </div>
          {overviewDataUrl && massingDataUrl ? (
            <CompareSlider beforeSrc={massingDataUrl} afterSrc={overviewDataUrl} beforeLabel="Clay model" afterLabel="Styled overview" />
          ) : overviewDataUrl ? (
            <CompareSlider beforeSrc={planDataUrl} afterSrc={overviewDataUrl} />
          ) : (
            <div className="media-frame relative mx-auto block w-fit max-w-full bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={massingDataUrl!} alt="Axonometric clay model of the house" className="block max-h-[50vh] w-auto max-w-full" />
              {overviewLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-neutral-200 backdrop-blur-sm">
                  Styling the overview from this model… usually 1–3 minutes.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRenderRoom}
          disabled={busy || houseStatus !== "ready" || selectedRoom === null}
          className="btn-primary"
        >
          {selectedLabel ? `Render ${selectedLabel} →` : "Pick a room in the model"}
        </button>
        <button
          type="button"
          onClick={onGenerateOverview}
          disabled={busy}
          className="btn-secondary"
        >
          {overviewLoading ? "Styling overview…" : overviewDataUrl ? "Restyle overview" : "Styled overview (AI, optional)"}
        </button>
        {houseStatus !== "failed" && (
          <button type="button" onClick={onDrawBox} disabled={busy} className="btn-ghost">
            Draw a box instead
          </button>
        )}
        <button type="button" onClick={onReset} className="btn-ghost ml-auto">
          Start over
        </button>
      </div>
    </div>
  );
}
