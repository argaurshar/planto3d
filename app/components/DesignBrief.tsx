"use client";

import type { DesignBrief } from "@/lib/types";
import { STYLE_PRESETS } from "@/lib/styles";

interface Props {
  brief: DesignBrief;
  disabled?: boolean;
  onChange: (patch: Partial<DesignBrief>) => void;
}

const inputCls = "input";

/** The global "design brief": style, lighting, and optional plan metadata. */
export default function DesignBrief({ brief, disabled, onChange }: Props) {
  const numeric = (v: string): number | undefined => {
    const n = Number(v);
    return v === "" || !Number.isFinite(n) ? undefined : n;
  };

  return (
    <div className="panel space-y-3 p-4">
      <h2 className="eyebrow">Design brief</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-neutral-400">Style</span>
          <select
            className={inputCls}
            value={brief.styleId}
            disabled={disabled}
            onChange={(e) => onChange({ styleId: e.target.value })}
          >
            {STYLE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-neutral-400">Lighting</span>
          <input
            className={inputCls}
            type="text"
            value={brief.lighting}
            disabled={disabled}
            placeholder="natural afternoon light from the east"
            onChange={(e) => onChange({ lighting: e.target.value })}
          />
        </label>
      </div>

      {brief.styleId === "custom" && (
        <label className="space-y-1">
          <span className="text-xs text-neutral-400">Describe your style</span>
          <input
            className={inputCls}
            type="text"
            value={brief.customStyle ?? ""}
            disabled={disabled}
            placeholder="e.g. warm boho with rattan and terracotta"
            onChange={(e) => onChange({ customStyle: e.target.value })}
          />
        </label>
      )}

      <details className="text-sm text-neutral-400">
        <summary className="cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-300">
          Optional plan details (sharpens the overview)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs text-neutral-400">Area (sqm)</span>
            <input
              className={inputCls}
              type="number"
              min={0}
              value={brief.areaSqm ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ areaSqm: numeric(e.target.value) })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-neutral-400">Beds</span>
            <input
              className={inputCls}
              type="number"
              min={0}
              value={brief.beds ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ beds: numeric(e.target.value) })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-neutral-400">Baths</span>
            <input
              className={inputCls}
              type="number"
              min={0}
              value={brief.baths ?? ""}
              disabled={disabled}
              onChange={(e) => onChange({ baths: numeric(e.target.value) })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-neutral-400">Dwelling</span>
            <input
              className={inputCls}
              type="text"
              value={brief.dwelling ?? ""}
              disabled={disabled}
              placeholder="apartment"
              onChange={(e) => onChange({ dwelling: e.target.value || undefined })}
            />
          </label>
        </div>
      </details>
    </div>
  );
}
