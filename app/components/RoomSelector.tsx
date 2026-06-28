"use client";

import { useRef, useState } from "react";
import { normalizeRect, type Rect } from "@/lib/crop";
import { ROOM_TYPES, type RoomType } from "@/lib/types";

interface Props {
  planDataUrl: string;
  loading: boolean;
  roomType: RoomType;
  onRoomTypeChange: (value: RoomType) => void;
  onSelect: (rect: Rect) => void;
  onBack: () => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Step 4: draw a box around a room. Reports the selection in NATURAL image
 * pixel coordinates so the crop is full-resolution.
 */
export default function RoomSelector({
  planDataUrl,
  loading,
  roomType,
  onRoomTypeChange,
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-neutral-300">
          Which room? Drag a box around a room on the plan to build it in 3D.
        </p>
        <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
          Room type
          <select
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-emerald-500 disabled:opacity-50"
            value={roomType}
            disabled={loading}
            onChange={(e) => onRoomTypeChange(e.target.value as RoomType)}
          >
            {ROOM_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="relative inline-block max-w-full select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={planDataUrl}
          alt="2D floor plan — drag to select a room"
          draggable={false}
          className="block max-h-[70vh] w-auto max-w-full rounded-lg border border-neutral-800 bg-white"
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          ← Back to overview
        </button>
        {loading && (
          <span className="text-sm text-emerald-400">Building room…</span>
        )}
      </div>
    </div>
  );
}
