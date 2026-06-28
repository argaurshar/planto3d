"use client";

interface Props {
  cropDataUrl: string | null;
  versions: string[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  onRegenerate: () => void;
  onEditPrompt: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPickAnother: () => void;
}

/** Step 5/6: show the room render, regenerate, and flip through versions. */
export default function RoomResult({
  cropDataUrl,
  versions,
  currentIndex,
  loading,
  error,
  onRegenerate,
  onEditPrompt,
  onPrev,
  onNext,
  onPickAnother,
}: Props) {
  const current = versions[currentIndex] ?? null;
  const hasMultiple = versions.length > 1;

  return (
    <div className="space-y-5">
      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <figure className="space-y-2">
          <figcaption className="text-xs uppercase tracking-wide text-neutral-500">
            Selected room
          </figcaption>
          {cropDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cropDataUrl}
              alt="Selected room crop from the plan"
              className="w-full rounded-lg border border-neutral-800 bg-white"
            />
          ) : null}
        </figure>

        <figure className="space-y-2">
          <figcaption className="flex items-center justify-between text-xs uppercase tracking-wide text-neutral-500">
            <span>Photorealistic interior</span>
            {versions.length > 0 && (
              <span className="normal-case tracking-normal text-neutral-400">
                version {currentIndex + 1} / {versions.length}
              </span>
            )}
          </figcaption>
          <div className="flex min-h-[16rem] items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/50">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current}
                alt="Generated photorealistic interior render of the room"
                className="w-full rounded-lg"
              />
            ) : (
              <span className="px-4 py-8 text-center text-sm text-neutral-500">
                {loading ? "Building room…" : "No render yet."}
              </span>
            )}
          </div>
        </figure>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={loading}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Regenerating…" : "Regenerate"}
        </button>

        <button
          type="button"
          onClick={onEditPrompt}
          disabled={loading}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-800 disabled:opacity-40"
        >
          Edit prompt
        </button>

        {hasMultiple && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={currentIndex === 0}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm transition hover:bg-neutral-800 disabled:opacity-40"
              aria-label="Previous version"
            >
              ←
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={currentIndex === versions.length - 1}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm transition hover:bg-neutral-800 disabled:opacity-40"
              aria-label="Next version"
            >
              →
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onPickAnother}
          className="ml-auto rounded-lg border border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-800"
        >
          Pick another room
        </button>
      </div>
    </div>
  );
}
