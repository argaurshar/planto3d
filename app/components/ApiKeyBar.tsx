"use client";

import { useEffect, useState } from "react";
import { IS_STATIC, getStoredKey, setStoredKey } from "@/lib/api";

/**
 * Shown only in the static (GitHub Pages) build. Lets the user paste their own
 * kie.ai key, which is stored in this browser's localStorage and used for
 * direct browser → kie.ai calls. The key is never sent anywhere else and is
 * never committed to the repo.
 */
export default function ApiKeyBar() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKey(getStoredKey());
  }, []);

  if (!IS_STATIC) return null;

  function save() {
    setStoredKey(key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-amber-300/90">
          kie.ai API key
        </span>
        {getStoredKey() ? (
          <span className="text-xs text-emerald-400">key saved in this browser</span>
        ) : (
          <span className="text-xs text-amber-400">required to generate</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your kie.ai API key"
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-emerald-400"
        >
          {saved ? "Saved ✓" : "Save key"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Stored only in your browser (localStorage). Generation calls go straight
        from your browser to kie.ai — get a key at{" "}
        <a
          href="https://kie.ai/api-key"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-300"
        >
          kie.ai/api-key
        </a>
        .
      </p>
    </div>
  );
}
