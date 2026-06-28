"use client";

interface Props {
  cropDataUrl: string | null;
  prompt: string;
  /** "writing" while the LLM drafts the prompt; "rendering" during the image. */
  stage: "idle" | "writing" | "rendering";
  error: string | null;
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
  onPromptChange,
  onRender,
  onRewrite,
  onBack,
}: Props) {
  const busy = stage !== "idle";
  const writing = stage === "writing";

  return (
    <div className="card space-y-4 p-4">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <figure className="space-y-2">
          <figcaption className="eyebrow">Selected room</figcaption>
          {cropDataUrl && (
            <div className="media-frame bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cropDataUrl}
                alt="Selected room crop from the plan"
                className="block w-full"
              />
            </div>
          )}
        </figure>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Interior prompt (editable)</span>
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
            className="h-56 w-full resize-y rounded-lg border border-white/10 bg-neutral-950/60 p-3 text-sm leading-relaxed text-neutral-100 outline-none focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRender}
          disabled={busy || !prompt.trim()}
          className="btn-primary"
        >
          {stage === "rendering" ? "Rendering…" : "Render 3D interior"}
        </button>
        <button type="button" onClick={onBack} disabled={busy} className="btn-ghost">
          ← Pick a different room
        </button>
      </div>
    </div>
  );
}
