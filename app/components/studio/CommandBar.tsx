"use client";

import { useState } from "react";

export interface LogLine {
  id: number;
  who: "you" | "app";
  text: string;
  tone?: "ok" | "err" | "ai" | "info";
}

interface Props {
  suggestions: string[];
  log: LogLine[];
  busy: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onRun: (text: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** "Tell me what to change": typed edits to the model, with suggestions and a short history. */
export default function CommandBar({ suggestions, log, busy, canUndo, canRedo, onRun, onUndo, onRedo }: Props) {
  const [text, setText] = useState("");
  const submit = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    onRun(v);
    setText("");
  };
  return (
    <div className="panel space-y-3 p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell me what to change — e.g. add bed back, change side table design, delete that"
          className="input flex-1"
          aria-label="Command"
        />
        <button type="submit" disabled={!text.trim() || !!busy} className="btn-primary px-4">
          {busy ? "…" : "Apply"}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onUndo} disabled={!canUndo} className="btn-ghost text-xs disabled:opacity-40" title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} className="btn-ghost text-xs disabled:opacity-40" title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => submit(s)} disabled={!!busy} className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-white/5 hover:text-white">
            {s}
          </button>
        ))}
      </div>
      {(busy || log.length > 0) && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs" aria-live="polite">
          {log.slice(-8).map((l) => (
            <li
              key={l.id}
              className={
                l.who === "you"
                  ? "text-neutral-500"
                  : l.tone === "err"
                    ? "text-red-300"
                    : l.tone === "ai"
                      ? "text-sky-200"
                      : l.tone === "info"
                        ? "text-amber-200/90"
                        : "text-emerald-200"
              }
            >
              {l.who === "you" ? "› " : ""}
              {l.text}
            </li>
          ))}
          {busy && <li className="animate-pulse text-neutral-400">{busy}</li>}
        </ul>
      )}
    </div>
  );
}
