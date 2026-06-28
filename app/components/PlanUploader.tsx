"use client";

import { useRef, useState } from "react";

interface Props {
  onPlanSelected: (dataUrl: string) => void;
}

/** Step 1: pick a 2D plan image and hand its data URL upward. */
export default function PlanUploader({ onPlanSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
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

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-neutral-900/40 px-6 py-20 text-center transition hover:border-emerald-500/70 hover:bg-neutral-900/70"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-emerald-400 transition group-hover:border-emerald-500/40">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </span>
        <span className="text-base font-medium">Upload a 2D floor plan</span>
        <span className="text-sm text-neutral-400">
          Click to choose an image (PNG, JPG)
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
