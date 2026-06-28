"use client";

import { useEffect, useState } from "react";
import { IS_STATIC, getStoredKey, setStoredKey } from "@/lib/api";

/** Event other components dispatch to reopen the key bar to change the key. */
export const OPEN_KEYBAR_EVENT = "voxa:open-keybar";

/**
 * Shown only in the static (GitHub Pages) build. The bar is visible only while
 * there is no saved key (or when the user explicitly reopens it to change it).
 * Once a key is saved it disappears completely; a discreet footer link can
 * bring it back.
 */
export default function ApiKeyBar() {
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const existing = getStoredKey();
    setKey(existing);
    setOpen(!existing); // open only if no key yet
    setReady(true);

    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_KEYBAR_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_KEYBAR_EVENT, onOpen);
  }, []);

  if (!IS_STATIC || !ready || !open) return null;

  function save() {
    setStoredKey(key);
    setOpen(false); // remove the bar completely once a key is saved
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-amber-300/90">kie.ai API key</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide API key bar"
          className="rounded-md px-1.5 text-neutral-500 transition hover:text-neutral-200"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your kie.ai API key"
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={save} disabled={!key.trim()} className="btn-primary">
          Save key
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Stored only in your browser (localStorage) and used straight from your
        browser to kie.ai — get a key at{" "}
        <a
          href="https://kie.ai/api-key"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-300"
        >
          kie.ai/api-key
        </a>
        . This bar disappears once your key is saved.
      </p>
    </div>
  );
}
