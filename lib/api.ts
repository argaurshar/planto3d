import type { DesignBrief, GenerateImageResponse, RoomPromptResponse, RoomType } from "./types";
import { overviewPrompt } from "./prompts";
import {
  generateImageBrowser,
  writeRoomPromptBrowser,
  roomRenderPrompt,
} from "./kieBrowser";

// In the static (GitHub Pages) build there is no server, so generation runs in
// the browser with a user-supplied key. The server build keeps the secure
// route handlers. NEXT_PUBLIC_STATIC is set to "true" only for the Pages build.
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC === "true";

const API_KEY_STORAGE = "planto3d_kie_key";

export function getStoredKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(API_KEY_STORAGE) || "";
}

export function setStoredKey(key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (trimmed) window.localStorage.setItem(API_KEY_STORAGE, trimmed);
  else window.localStorage.removeItem(API_KEY_STORAGE);
}

function requireKey(): string {
  const key = getStoredKey();
  if (!key) {
    throw new Error("Add your kie.ai API key at the top of the page to generate.");
  }
  return key;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // ignore parse errors, keep default message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Stage 1: generate the whole-plan axonometric overview. Returns an image URL. */
export async function requestOverview(
  planDataUrl: string,
  brief: DesignBrief,
): Promise<string> {
  if (IS_STATIC) {
    return generateImageBrowser(overviewPrompt(brief), [planDataUrl], requireKey(), "plan.png");
  }
  const data = await postJson<GenerateImageResponse>("/api/overview", {
    plan: planDataUrl,
    brief,
  });
  return data.image;
}

/**
 * Stage 3a: auto-write the interior prompt for a cropped room. The overview URL
 * (if available) is always passed so the LLM keeps whole-home style consistency.
 */
export async function requestRoomPrompt(
  roomDataUrl: string,
  brief: DesignBrief,
  roomType: RoomType,
  overviewUrl?: string,
): Promise<string> {
  if (IS_STATIC) {
    return writeRoomPromptBrowser({
      cropDataUrl: roomDataUrl,
      brief,
      roomType,
      apiKey: requireKey(),
      overviewUrl,
    });
  }
  const data = await postJson<RoomPromptResponse>("/api/room", {
    action: "write",
    room: roomDataUrl,
    brief,
    roomType,
    reference: overviewUrl,
  });
  return data.prompt;
}

/**
 * Stage 3b: render a photorealistic interior from a (possibly edited) prompt.
 * `overviewUrl` is passed only when the user opts to use it as a style
 * reference for the render.
 */
export async function requestRoomRender(
  roomDataUrl: string,
  prompt: string,
  variation: number,
  brief: DesignBrief,
  overviewUrl?: string,
): Promise<string> {
  if (IS_STATIC) {
    const inputs = overviewUrl ? [roomDataUrl, overviewUrl] : [roomDataUrl];
    return generateImageBrowser(
      roomRenderPrompt(prompt, variation, brief, Boolean(overviewUrl)),
      inputs,
      requireKey(),
      "room.png",
    );
  }
  const data = await postJson<GenerateImageResponse>("/api/room", {
    action: "render",
    room: roomDataUrl,
    prompt,
    variation,
    brief,
    reference: overviewUrl,
  });
  return data.image;
}
