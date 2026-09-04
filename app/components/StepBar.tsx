"use client";

type Step = "upload" | "overview" | "select" | "roomSetup" | "roomPrompt" | "room";

const STEPS: { key: Step[]; label: string }[] = [
  { key: ["overview"], label: "3D overview" },
  { key: ["select", "roomSetup"], label: "Pick a room" },
  { key: ["roomPrompt"], label: "Prompt & layout" },
  { key: ["room"], label: "Interior render" },
];

/** Compact progress bar shown on every step after upload, so users always know where they are. */
export default function StepBar({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.key.includes(step));
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                state === "done"
                  ? "bg-emerald-400/20 text-emerald-300"
                  : state === "active"
                    ? "bg-emerald-400 text-emerald-950"
                    : "bg-white/5 text-neutral-500"
              }`}
              aria-current={state === "active" ? "step" : undefined}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={state === "active" ? "text-neutral-100" : "text-neutral-500"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-white/10 sm:w-8" />}
          </li>
        );
      })}
    </ol>
  );
}
