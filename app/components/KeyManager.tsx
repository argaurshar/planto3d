"use client";

import { useEffect, useState } from "react";
import { getStoredKey, IS_STATIC, setStoredKey } from "@/lib/ai/client";
import { isGoogleKey } from "@/lib/ai/google";

/**
 * Bottom-of-page AI key. One field takes either a Google AI Studio key
 * (AIza…, calls Gemini + Nano Banana directly) or a kie.ai key. The key is
 * kept only in this browser (localStorage) and sent only to that provider.
 */
export default function KeyManager() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    const k = getStoredKey();
    setKey(k);
    setSaved(k);
    setReady(true);
  }, []);

  if (!ready) return null;

  const save = (v: string) => {
    setStoredKey(v);
    setSaved(v.trim());
    setOpen(false);
    window.dispatchEvent(new Event("planto3d-key"));
  };
  const kind = saved ? (isGoogleKey(saved) ? "Google Gemini" : "kie.ai") : null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-neutral-300 hover:underline">
        <span className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-emerald-400" : "bg-amber-400"}`} />
        {saved ? `AI key: ${kind} · change` : IS_STATIC ? "Add your AI key (Google AI Studio or kie.ai)" : "Use your own AI key (optional)"}
      </button>
    );
  }

  return (
    <div className="card w-full max-w-md space-y-3 p-4 text-left">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-amber-300/90">AI key</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-1.5 text-neutral-500 transition hover:text-neutral-200">
          ✕
        </button>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(key);
        }}
      >
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza… (Google) or your kie.ai key" className="input min-w-0 flex-1" autoComplete="off" />
        <button type="submit" disabled={!key.trim()} className="btn-primary">
          Save
        </button>
        {saved && (
          <button type="button" onClick={() => { setKey(""); save(""); }} className="btn-ghost text-xs">
            Remove
          </button>
        )}
      </form>
      <p className="text-[11px] leading-relaxed text-neutral-500">
        A <span className="text-neutral-300">Google AI Studio</span> key (free tier available at{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline hover:text-neutral-300">
          aistudio.google.com/apikey
        </a>
        ) reads plans with Gemini and makes renders with Nano Banana. A{" "}
        <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer" className="underline hover:text-neutral-300">
          kie.ai
        </a>{" "}
        key works too. The key stays in this browser and goes only to that provider. The 3D model, shots, edits and Blender export need no key.
      </p>
    </div>
  );
}
