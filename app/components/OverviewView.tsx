"use client";

interface Props {
  planDataUrl: string;
  overviewDataUrl: string | null;
  loading: boolean;
  onGenerate: () => void;
  onProceed: () => void;
  onReset: () => void;
}

/** Step 2/3: show the plan, generate the axonometric overview, then Proceed. */
export default function OverviewView({
  planDataUrl,
  overviewDataUrl,
  loading,
  onGenerate,
  onProceed,
  onReset,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <figure className="space-y-2">
          <figcaption className="text-xs uppercase tracking-wide text-neutral-500">
            2D plan
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={planDataUrl}
            alt="Uploaded 2D floor plan"
            className="w-full rounded-lg border border-neutral-800 bg-white"
          />
        </figure>

        <figure className="space-y-2">
          <figcaption className="text-xs uppercase tracking-wide text-neutral-500">
            Axonometric overview
          </figcaption>
          <div className="flex min-h-[12rem] items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/50">
            {overviewDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={overviewDataUrl}
                alt="Generated axonometric overview of the plan"
                className="w-full rounded-lg"
              />
            ) : (
              <span className="px-4 py-8 text-center text-sm text-neutral-500">
                {loading
                  ? "Generating overview…"
                  : "Generate an axonometric overview of the whole plan."}
              </span>
            )}
          </div>
        </figure>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "Generating…"
            : overviewDataUrl
              ? "Regenerate overview"
              : "Generate overview"}
        </button>

        <button
          type="button"
          onClick={onProceed}
          disabled={!overviewDataUrl || loading}
          className="rounded-lg border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Proceed → pick a room
        </button>

        <button
          type="button"
          onClick={onReset}
          className="ml-auto text-sm text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
