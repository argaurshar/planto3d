"use client";

import { useRef, useState } from "react";

interface Props {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
}

/**
 * Before/after comparison slider. The "before" (2D plan) is the base; the
 * "after" (3D overview) is revealed from the left up to the divider, which the
 * user drags to compare the two.
 */
export default function CompareSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "2D plan",
  afterLabel = "3D overview",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  function moveTo(clientX: number) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, p)));
  }

  return (
    <div
      ref={ref}
      className="media-frame relative touch-none select-none bg-white"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => dragging && moveTo(e.clientX)}
      onPointerUp={() => setDragging(false)}
    >
      {/* Base: 2D plan defines the box size */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={beforeSrc} alt={beforeLabel} draggable={false} className="block w-full" />

      {/* Overlay: 3D overview, revealed up to the divider */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterSrc}
        alt={afterLabel}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      {/* Labels */}
      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white">
        {afterLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white">
        {beforeLabel}
      </span>

      {/* Divider + handle */}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-black/60 text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 7 4 12 9 17" />
            <polyline points="15 7 20 12 15 17" />
          </svg>
        </div>
      </div>
    </div>
  );
}
