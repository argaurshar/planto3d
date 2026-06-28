"use client";

import { IS_STATIC } from "@/lib/api";
import { OPEN_KEYBAR_EVENT } from "./ApiKeyBar";

/**
 * A discreet footer link (static build only) to reopen the API-key bar after it
 * has auto-hidden, so the user can change their key without it cluttering the UI.
 */
export default function ManageKeyLink() {
  if (!IS_STATIC) return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_KEYBAR_EVENT))}
      className="underline-offset-2 hover:text-neutral-300 hover:underline"
    >
      Change API key
    </button>
  );
}
