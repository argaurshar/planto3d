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
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-700 bg-neutral-900/50 px-6 py-16 text-center transition hover:border-emerald-500 hover:bg-neutral-900"
      >
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
