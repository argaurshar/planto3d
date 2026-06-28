"use client";

import type { DesignBrief as Brief } from "@/lib/types";
import DesignBrief from "./DesignBrief";
import CompareSlider from "./CompareSlider";
import DownloadButton from "./DownloadButton";

interface Props {
  planDataUrl: string;
  overviewDataUrl: string | null;
  brief: Brief;
  loading: boolean;
  onBriefChange: (patch: Partial<Brief>) => void;
  onGenerate: () => void;
  onApprove: () => void;
  onReset: () => void;
}

/** Step 2/3: set the brief, generate the axonometric overview, then Approve. */
export default function OverviewView({
  planDataUrl,
  overviewDataUrl,
  brief,
  loading,
  onBriefChange,
  onGenerate,
  onApprove,
  onReset,
}: Props) {
  return (
    <div className="space-y-6">
      <DesignBrief brief={brief} disabled={loading} onChange={onBriefChange} />

      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow">
            {overviewDataUrl ? "2D ↔ 3D — drag to compare" : "Your 2D plan"}
          </span>
          {overviewDataUrl && (
            <DownloadButton url={overviewDataUrl} filename="planto3d-overview.png" />
          )}
        </div>

        {overviewDataUrl ? (
          <CompareSlider beforeSrc={planDataUrl} afterSrc={overviewDataUrl} />
        ) : (
          <div className="media-frame relative bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={planDataUrl} alt="Uploaded 2D floor plan" className="block w-full" />
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-neutral-200 backdrop-blur-sm">
                Generating axonometric overview…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onGenerate} disabled={loading} className="btn-primary">
          {loading
            ? "Generating…"
            : overviewDataUrl
              ? "Regenerate overview"
              : "Generate overview"}
        </button>

        <button
          type="button"
          onClick={onApprove}
          disabled={!overviewDataUrl || loading}
          className="btn-secondary"
        >
          Approve → pick a room
        </button>

        <button type="button" onClick={onReset} className="btn-ghost ml-auto">
          Start over
        </button>
      </div>
    </div>
  );
}
