import type { DesignBrief, GenerateImageResponse, RenderEngine, RoomPromptResponse, RoomType } from "./types";
import type { SpatialBox, RoomSize } from "./spatial";
import { overviewPrompt } from "./prompts";
import { renderWithEngine, type EngineTransport } from "./renderEngine";
import {
  generateImageBrowser,
  generateKontextImageBrowser,
  generateReferenceImageBrowser,
  generateStructureImageBrowser,
  toHostedUrl as toHostedUrlBrowser,
  verifyRenderLayoutBrowser,
  writeRoomPromptBrowser,
  roomRenderPrompt,
} from "./kieBrowser";
import { renderWithVerification } from "./verifyLoop";

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

/** The render plus its layout check (same shape as the route's response, minus mimeType). */
export type RoomRenderResult = Omit<GenerateImageResponse, "mimeType">;

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
export interface RoomRenderOptions {
  /** Which model turns the blockout into the photo (default: reference). */
  engine?: RenderEngine;
  /** Depth map of the blockout view, for the reference engine. */
  depthDataUrl?: string;
}

export async function requestRoomRender(
  prompt: string,
  variation: number,
  brief: DesignBrief,
  blockoutDataUrl?: string,
  layoutText?: string,
  { engine = "reference", depthDataUrl }: RoomRenderOptions = {},
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
    // Same render → verify → retry loop as the server route (lib/verifyLoop.ts).
    // The inputs are uploaded once and their URLs reused by every generation.
    const [clayUrl, depthUrl] = await Promise.all([
      toHostedUrlBrowser(blockoutDataUrl!, key, "blockout.png"),
      depthDataUrl ? toHostedUrlBrowser(depthDataUrl, key, "depth.png") : Promise.resolve(undefined),
    ]);
    const transport: EngineTransport = {
      reference: (p, inputs) => generateReferenceImageBrowser(p, inputs, key),
      structure: (p, input, strength, negative) =>
        generateStructureImageBrowser(p, input, strength, negative, key),
      edit: (p, input) => generateKontextImageBrowser(p, input, key),
    };
    const run = (corrections?: string[]) =>
      renderWithEngine(engine, transport, { interior: prompt, brief, clayUrl, depthUrl, corrections });
    return renderWithVerification({
      layout: layoutText,
      verify: (url, layout) => verifyRenderLayoutBrowser(url, layout, key),
      render: async (corrections) => {
        if (corrections) return run(corrections);
        try {
          return await run();
        } catch {
          // Engine unavailable → nano-banana img2img from the massing.
          return generateImageBrowser(roomRenderPrompt(prompt, variation, brief, true), [clayUrl], key, "room.png");
        }
      },
    });
  }
  const data = await postJson<GenerateImageResponse>("/api/room", {
    action: "render",
    prompt,
    variation,
    brief,
    blockout: blockoutDataUrl,
    depth: depthDataUrl,
    engine,
    layout: layoutText,
  });
  return { image: data.image, verification: data.verification };
}
