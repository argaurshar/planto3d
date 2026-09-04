// Shared kie.ai polling policy — pure, no `server-only`, imported by both the
// server client (lib/kie.ts) and the browser client (lib/kieBrowser.ts) so the
// two builds cannot drift (the lib/spatial.ts precedent).

/**
 * Image jobs regularly take 2-3 minutes (nano-banana-2 observed at 160s), so
 * the poll window must be generously longer than the model's worst case: giving
 * up early abandons an image kie.ai has already generated and billed for.
 */
export const POLL_TIMEOUT_MS = 300_000;
export const POLL_INTERVAL_MS = 3000;

/**
 * kie.ai reports failMsg "generate task timeout" on slow jobs that then flip to
 * success (seen in the dashboard ~60s later). We tolerate such a fail state for
 * this long before treating it as terminal — long enough to cover the observed
 * flip, short enough that a genuinely dead task surfaces its real error well
 * before the 5-minute poll window ends.
 */
export const TRANSIENT_FAIL_GRACE_MS = 120_000;

/** Only the observed timeout wording is transient; everything else is terminal. */
export function isTransientFailure(msg?: string | null): boolean {
  return /timeou?t|timed out/i.test(msg || "");
}

/**
 * Tracks how long a task has been sitting in a transient fail state.
 * `tolerate(msg)` is true while polling should continue despite `fail`;
 * call `reset()` whenever the task reports a non-fail state.
 */
export function transientFailGate(): {
  tolerate(msg?: string | null): boolean;
  reset(): void;
} {
  let since: number | null = null;
  return {
    tolerate(msg) {
      if (!isTransientFailure(msg)) return false;
      const now = Date.now();
      if (since === null) since = now;
      return now - since < TRANSIENT_FAIL_GRACE_MS;
    },
    reset() {
      since = null;
    },
  };
}

/** User-facing message when our own poll window runs out, derived from the constant. */
export function pollTimeoutMessage(what: string, timeoutMs = POLL_TIMEOUT_MS): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return `${what} is still running after ${minutes} minute${minutes === 1 ? "" : "s"}. kie.ai may yet finish it — check your kie.ai dashboard for the result, or try again.`;
}
