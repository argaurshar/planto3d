"use client";

interface Props {
  cropDataUrl: string | null;
  prompt: string;
  /** "writing" while the LLM drafts the prompt; "rendering" during the image. */
  stage: "idle" | "writing" | "rendering";
  error: string | null;
  useOverview: boolean;
  hasOverview: boolean;
  onToggleOverview: (value: boolean) => void;
  onPromptChange: (value: string) => void;
  onRender: () => void;
  onRewrite: () => void;
  onBack: () => void;
}

/**
 * Stage 3a UI: show the cropped room and the auto-written interior prompt in an
 * editable box, then Render (Stage 3b). The user can tweak the prompt or have
 * the model rewrite it.
 */
export default function RoomPrompt({
  cropDataUrl,
  prompt,
  stage,
  error,
  useOverview,
  hasOverview,
  onToggleOverview,
  onPromptChange,
  onRender,
  onRewrite,
  onBack,
}: Props) {
  const busy = stage !== "idle";
  const writing = stage === "writing";

  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <figure className="space-y-2">
          <figcaption className="text-xs uppercase tracking-wide text-neutral-500">
            Selected room
          </figcaption>
          {cropDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cropDataUrl}
              alt="Selected room crop from the plan"
              className="w-full rounded-lg border border-neutral-800 bg-white"
            />
          )}
        </figure>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              Interior prompt (editable)
            </span>
            <button
              type="button"
              onClick={onRewrite}
              disabled={busy}
              className="text-xs text-neutral-400 underline-offset-2 hover:text-neutral-200 hover:underline disabled:opacity-40"
            >
              {writing ? "Writing…" : "Rewrite with AI"}
            </button>
          </div>
          <textarea
            className="h-56 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm leading-relaxed text-neutral-100 outline-none focus:border-emerald-500 disabled:opacity-60"
            value={prompt}
            disabled={writing}
            placeholder={
              writing
                ? "Writing a detailed interior prompt from your room…"
                : "Describe the photorealistic interior to render…"
            }
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {hasOverview && (
        <label className="flex items-start gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            checked={useOverview}
            disabled={busy}
            onChange={(e) => onToggleOverview(e.target.checked)}
            className="mt-0.5 accent-emerald-500"
          />
          <span>
            Also use the axonometric overview as a style reference for the render{" "}
            <span className="text-neutral-500">
              (experimental — keeps materials consistent with the whole home; may
              slightly nudge the camera toward a 3D-model look)
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRender}
          disabled={busy || !prompt.trim()}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stage === "rendering" ? "Rendering…" : "Render 3D interior"}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline disabled:opacity-40"
        >
          ← Pick a different room
        </button>
      </div>
    </div>
  );
}
