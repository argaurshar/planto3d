import type { DesignBrief, GenerateImageResponse, RoomPromptResponse, RoomType } from "./types";
import type { SpatialBox, RoomSize } from "./spatial";
import { overviewPrompt, kontextRenderPrompt } from "./prompts";
import {
  generateImageBrowser,
  generateKontextImageBrowser,
  verifyRenderLayoutBrowser,
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
    throw new Error(
      "Add your kie.ai API key (link at the bottom of the page) to generate.",
    );
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
): Promise<{ prompt: string; boxes: SpatialBox[]; roomSize: RoomSize | null }> {
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
  return { prompt: data.prompt, boxes: data.boxes ?? [], roomSize: data.roomSize ?? null };
}

export interface RoomRenderResult {
  image: string;
  /** true = layout check passed; false = still off after a retry; undefined = not checked. */
  verified?: boolean;
}

/**
 * Stage 3b: render a photorealistic eye-level interior from the (possibly
 * edited) detailed prompt.
 *
 * With a `blockoutDataUrl` (the colour-coded eye-level massing of the room)
 * this renders via FLUX.1 Kontext — a structure-preserving EDIT model — so the
 * walls/window/door/furniture positions are carried by the image, then a vision
 * check compares the result against `layoutText` and retries once with
 * corrections if it drifted. Without a blockout it falls back to TEXT-TO-IMAGE.
 */
export async function requestRoomRender(
  prompt: string,
  variation: number,
  brief: DesignBrief,
  blockoutDataUrl?: string,
  layoutText?: string,
): Promise<RoomRenderResult> {
  const hasBlockout = Boolean(blockoutDataUrl);
  if (IS_STATIC) {
    const key = requireKey();
    if (!hasBlockout) {
      const image = await generateImageBrowser(
        roomRenderPrompt(prompt, variation, brief, false),
        [],
        key,
        "room.png",
      );
      return { image };
    }
    let image: string;
    try {
      image = await generateKontextImageBrowser(
        kontextRenderPrompt(prompt, brief),
        blockoutDataUrl!,
        key,
      );
    } catch {
      // Kontext unavailable → previous behavior (nano-banana img2img).
      image = await generateImageBrowser(
        roomRenderPrompt(prompt, variation, brief, true),
        [blockoutDataUrl!],
        key,
        "room.png",
      );
    }
    if (!layoutText) return { image };
    const check = await verifyRenderLayoutBrowser(image, layoutText, key);
    if (!check) return { image };
    if (check.matches) return { image, verified: true };
    try {
      const retryImage = await generateKontextImageBrowser(
        kontextRenderPrompt(prompt, brief, check.problems),
        blockoutDataUrl!,
        key,
      );
      const check2 = await verifyRenderLayoutBrowser(retryImage, layoutText, key);
      return { image: retryImage, verified: check2 ? check2.matches : undefined };
    } catch {
      return { image, verified: false };
    }
  }
  const data = await postJson<GenerateImageResponse>("/api/room", {
    action: "render",
    prompt,
    variation,
    brief,
    blockout: blockoutDataUrl,
    layout: layoutText,
  });
  return { image: data.image, verified: data.verified };
}
