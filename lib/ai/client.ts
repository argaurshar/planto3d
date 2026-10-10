// Browser entry point for AI jobs. With a key saved in this browser the call
// goes straight to Google or kie.ai; without one, the server build falls back
// to its own key through /api/ai. The static (GitHub Pages) build has no
// server, so it needs a key.

import type { RoomModel, Shot } from "../room/types";
import type { PlanReading } from "../room/read";
import { providerFor, providerLabel, runCommand, runReadPlan, runRealistic, type Provider } from "./run";

export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === "true";

const KEY_STORAGE = "planto3d_ai_key";
const LEGACY_KIE_KEY = "planto3d_kie_key";

export function getStoredKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY_STORAGE) || window.localStorage.getItem(LEGACY_KIE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const k = key.trim();
    if (k) window.localStorage.setItem(KEY_STORAGE, k);
    else window.localStorage.removeItem(KEY_STORAGE);
    window.localStorage.removeItem(LEGACY_KIE_KEY);
  } catch {
    /* private mode: the key lasts for this page only */
  }
}

export function currentProvider(): Provider | null {
  const k = getStoredKey();
  return k ? providerFor(k) : null;
}

export function aiLabel(): string {
  const p = currentProvider();
  return p ? providerLabel(p) : IS_STATIC ? "AI (add a key)" : "AI";
}

export class NeedKeyError extends Error {
  constructor() {
    super("Add your Google AI Studio key (AIza…) or kie.ai key at the bottom of the page to use AI.");
  }
}

async function viaServer<T>(body: Record<string, unknown>): Promise<T> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const res = await fetch(`${base}/api/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error || `AI request failed (HTTP ${res.status}).`);
  return json;
}

function provider(): Provider | null {
  const p = currentProvider();
  if (!p && IS_STATIC) throw new NeedKeyError();
  return p;
}

export async function aiReadPlan(image: string, hint?: string): Promise<PlanReading> {
  const p = provider();
  if (p) return runReadPlan(p, image, hint);
  return (await viaServer<{ reading: PlanReading }>({ task: "read", image, hint })).reading;
}

export async function aiCommand(room: RoomModel, text: string, selectedId: string | null): Promise<{ ops: unknown; reply: string }> {
  const p = provider();
  if (p) return runCommand(p, room, text, selectedId);
  return viaServer<{ ops: unknown; reply: string }>({ task: "command", room, text, selected: selectedId });
}

export async function aiRealistic(room: RoomModel, shot: Shot | null, image: string, extra = ""): Promise<string> {
  const p = provider();
  if (p) return runRealistic(p, room, shot, image, extra);
  return (await viaServer<{ image: string }>({ task: "render", room, shot, image, extra })).image;
}
