"use client";

import { useEffect, useState } from "react";
import { IS_STATIC, getStoredKey, setStoredKey } from "@/lib/api";

/**
 * Bottom-of-app key control (static / GitHub Pages build only). A discreet link
 * — "Add your kie.ai API key" (or "Change…" once set) — expands an inline input
 * right here in the footer, so key entry lives at the bottom and the top of the
 * app stays clean. The key is stored only in the browser (localStorage).
 */
export default function KeyManager() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    const k = getStoredKey();
    setKey(k);
    setHasKey(Boolean(k));
    setReady(true);
  }, []);

  if (!IS_STATIC || !ready) return null;

  function save() {
    setStoredKey(key);
    setHasKey(Boolean(key.trim()));
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-neutral-300 hover:underline"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-amber-400"}`} />
        {hasKey ? "Change your kie.ai API key" : "Add your kie.ai API key"}
      </button>
    );
  }

  return (
    <div className="card w-full max-w-md space-y-3 p-4 text-left">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-amber-300/90">kie.ai API key</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
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
      <p className="text-[11px] leading-relaxed text-neutral-500">
        Stored only in this browser (localStorage) and sent straight from your
        browser to kie.ai. Get a key at{" "}
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
