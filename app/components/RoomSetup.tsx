"use client";

import { ROOM_TYPES, type RoomType } from "@/lib/types";
import { STYLE_PRESETS } from "@/lib/styles";

interface Props {
  cropDataUrl: string | null;
  roomType: RoomType;
  styleId: string;
  onRoomTypeChange: (value: RoomType) => void;
  onStyleChange: (value: string) => void;
  onGenerate: () => void;
  onBack: () => void;
}

/**
 * Step after drawing the box: a table to choose the interior TYPE and STYLE for
 * this specific room (overrides the global brief just for this render), then
 * generate the interior prompt.
 */
export default function RoomSetup({
  cropDataUrl,
  roomType,
  styleId,
  onRoomTypeChange,
  onStyleChange,
  onGenerate,
  onBack,
}: Props) {
  return (
    <div className="card space-y-5 p-4">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <figure className="space-y-2">
          <figcaption className="eyebrow">Selected room</figcaption>
          {cropDataUrl && (
            <div className="media-frame bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cropDataUrl} alt="Selected room crop" className="block w-full" />
            </div>
          )}
        </figure>

        <div className="space-y-5">
          <div className="space-y-2">
            <span className="eyebrow">Interior type</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROOM_TYPES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => onRoomTypeChange(r.value)}
                  className={`chip ${roomType === r.value ? "chip-active" : ""}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="eyebrow">Interior style</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onStyleChange(p.id)}
                  className={`chip ${styleId === p.id ? "chip-active" : ""}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {styleId === "custom" && (
              <p className="text-xs text-neutral-500">
                Custom uses the style text from your design brief above.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onGenerate} className="btn-primary">
          Generate interior prompt
        </button>
        <button type="button" onClick={onBack} className="btn-ghost">
          ← Pick a different room
        </button>
      </div>
    </div>
  );
}
