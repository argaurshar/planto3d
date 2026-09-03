"use client";

import { useRef, useState } from "react";
import { normalizeRect, type Rect } from "@/lib/crop";

interface Props {
  /** The 2D plan — the geometric source of truth the room is cropped from. */
  imageSrc: string;
  /** Optional generated 3D overview, shown alongside as a visual reference only. */
  referenceSrc?: string | null;
  loading: boolean;
  onSelect: (rect: Rect) => void;
  onBack: () => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Step 4: draw a box around a room ON THE 2D PLAN. Reports the selection in
 * NATURAL image pixel coordinates so the crop is full-resolution. The plan is
 * used (not the generated 3D overview) because it is the exact, top-down
 * geometry: detection and the 3D blockout treat crop coordinates as floor
 * coordinates, which is only true for a plan. The overview is shown next to it
 * purely as a visual reference.
 */
export default function RoomSelector({
  imageSrc,
  referenceSrc,
  loading,
  onSelect,
  onBack,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);

  // Pointer position in display (CSS) pixels relative to the image's top-left.
  function relativePoint(e: React.PointerEvent): Point {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  }

  function handleDown(e: React.PointerEvent) {
    if (loading) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = relativePoint(e);
    setStart(p);
    setCurrent(p);
  }

  function handleMove(e: React.PointerEvent) {
    if (!start) return;
    setCurrent(relativePoint(e));
  }

  function handleUp() {
    if (!start || !current || !imgRef.current) {
      setStart(null);
      setCurrent(null);
      return;
    }
    const img = imgRef.current;
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const display = normalizeRect(start, current);

    // Ignore tiny accidental drags.
    if (display.width < 6 || display.height < 6) {
      setStart(null);
      setCurrent(null);
      return;
    }

    const natural: Rect = {
      x: display.x * scaleX,
      y: display.y * scaleY,
      width: display.width * scaleX,
      height: display.height * scaleY,
    };
    onSelect(natural);
    setStart(null);
    setCurrent(null);
  }

  const box = start && current ? normalizeRect(start, current) : null;

  return (
    <div className="card space-y-4 p-4">
      <p className="text-sm text-neutral-300">
        <span className="font-medium text-neutral-100">Which room?</span> Drag a
        box around a room on the <span className="text-neutral-100">2D plan</span>{" "}
        — the exact geometry comes from the plan; the 3D overview is only a
        reference. You&apos;ll pick the room&apos;s type and style next.
      </p>

      <div className="flex flex-wrap items-start gap-4">
      <div className="relative inline-block max-w-full select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageSrc}
          alt="2D floor plan — drag to select a room"
          draggable={false}
          className="block max-h-[70vh] w-auto max-w-full rounded-xl border border-white/10 bg-white"
        />
        <div
          className="absolute inset-0 cursor-crosshair touch-none"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
        >
          {box && (
            <div
              className="absolute border-2 border-emerald-400 bg-emerald-400/20"
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
              }}
            />
          )}
        </div>
      </div>
      {referenceSrc && (
        <figure className="w-full max-w-xs shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={referenceSrc}
            alt="Generated 3D overview (reference)"
            draggable={false}
            className="block w-full rounded-xl border border-white/10 bg-white"
          />
          <figcaption className="mt-1 text-xs text-neutral-500">
            3D overview — reference only
          </figcaption>
        </figure>
      )}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="btn-ghost">
          ← Back to overview
        </button>
        {loading && <span className="text-sm text-emerald-400">Preparing…</span>}
      </div>
    </div>
  );
}
