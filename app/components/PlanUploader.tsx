"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onPlanSelected: (dataUrl: string) => void;
}

/**
 * Step 1: pick a 2D plan image and hand its data URL upward. Accepts a click,
 * a drag-and-drop, or a paste (Ctrl/Cmd+V of an image anywhere on the page).
 */
export default function PlanUploader({ onPlanSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  function handleFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG, etc.).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onPlanSelected(reader.result as string);
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsDataURL(file);
  }

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (item) handleFile(item.getAsFile());
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`group flex w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-14 text-center transition sm:py-16 ${
          over
            ? "border-emerald-400 bg-emerald-400/10"
            : "border-white/15 bg-white/[0.03] hover:border-emerald-500/70 hover:bg-white/[0.06]"
        }`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-emerald-400 transition group-hover:scale-105 group-hover:border-emerald-500/40">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </span>
        <span className="text-lg font-medium">
          {over ? "Drop it here" : "Drop your 2D floor plan here"}
        </span>
        <span className="text-sm text-neutral-400">
          or click to browse · PNG, JPG · you can also paste an image
        </span>
        <span className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[11px] text-neutral-500">
          <span className="rounded-full border border-white/10 px-2 py-0.5">Works with hand-drawn plans</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5">Printed dimensions are read automatically</span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
