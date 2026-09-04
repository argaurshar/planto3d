// Shared render → verify → one corrective retry loop for the layout-locked
// room render. Transport-agnostic (no kie.ai imports) so the server route and
// the static/browser build run the SAME state machine instead of two hand-kept
// copies that drift.

import type { LayoutVerification } from "./types";

export interface VerifiedRenderOptions {
  /**
   * Produce an image URL. Called once without corrections for the first
   * attempt (the caller may fall back to another model inside), then at most
   * once more with the verifier's `problems` as corrections.
   */
  render: (corrections?: string[]) => Promise<string>;
  /** Vision check of the image against the expected layout; null = check unavailable. */
  verify: (imageUrl: string, layout: string) => Promise<LayoutVerification | null>;
  /** Expected-layout text. No layout → no verification. */
  layout?: string;
  /** Whether a second (billed) render still fits the budget. Default: always. */
  canRetry?: () => boolean;
}

export interface VerifiedRender {
  image: string;
  /** Absent when the layout was not checked (no layout, or the verifier was unavailable). */
  verification?: LayoutVerification;
}

export async function renderWithVerification(o: VerifiedRenderOptions): Promise<VerifiedRender> {
  const image = await o.render();
  if (!o.layout) return { image };

  const check = await o.verify(image, o.layout);
  if (!check) return { image };
  if (check.matches) return { image, verification: check };

  // A mismatch with no stated problems gives the retry nothing to correct —
  // the prompt would be byte-identical — so don't pay for it.
  if (!check.problems.length) return { image, verification: check };
  // Skipped (and reported as failed) when the budget can't fit another
  // render, so the first, already-billed image is returned rather than lost.
  if (o.canRetry && !o.canRetry()) return { image, verification: check };

  try {
    const retry = await o.render(check.problems);
    const check2 = await o.verify(retry, o.layout);
    // If the re-check itself is unavailable, the only evidence says the
    // layout drifted once: keep the first pass's problems rather than
    // presenting the retry as unchecked.
    return { image: retry, verification: check2 ?? { matches: false, problems: check.problems } };
  } catch {
    return { image, verification: check };
  }
}
