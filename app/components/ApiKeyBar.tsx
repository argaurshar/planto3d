"use client";

import { useEffect, useState } from "react";
import { IS_STATIC, getStoredKey, setStoredKey } from "@/lib/api";

const HIDE_STORAGE = "planto3d_hide_keybar";

/**
 * Shown only in the static (GitHub Pages) build. Lets the user paste their own
 * kie.ai key (stored in this browser's localStorage, never committed) and fully
 * hide the bar — a small "API key" pill brings it back.
 */
export default function ApiKeyBar() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setKey(getStoredKey());
    setHidden(
      typeof window !== "undefined" &&
        window.localStorage.getItem(HIDE_STORAGE) === "1",
    );
    setReady(true);
  }, []);

  if (!IS_STATIC || !ready) return null;

  function save() {
    setStoredKey(key);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function hide() {
    setHidden(true);
    window.localStorage.setItem(HIDE_STORAGE, "1");
  }

  function show() {
    setHidden(false);
    window.localStorage.removeItem(HIDE_STORAGE);
  }

  if (hidden) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={show}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-400 transition hover:text-neutral-200"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${getStoredKey() ? "bg-emerald-400" : "bg-amber-400"}`}
          />
          API key
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-amber-300/90">kie.ai API key</span>
        <div className="flex items-center gap-3">
          {getStoredKey() ? (
            <span className="text-xs text-emerald-400">saved in this browser</span>
          ) : (
            <span className="text-xs text-amber-400">required to generate</span>
          )}
          <button
            type="button"
            onClick={hide}
            aria-label="Hide API key bar"
            className="rounded-md px-1.5 text-neutral-500 transition hover:text-neutral-200"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your kie.ai API key"
          className="input min-w-0 flex-1"
        />
        <button type="button" onClick={save} className="btn-primary">
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
        . Hide this bar with ✕.
      </p>
    </div>
  );
}
