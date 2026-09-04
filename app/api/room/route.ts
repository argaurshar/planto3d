import { NextResponse } from "next/server";

import { generateImage, generateKontextImage, KieError, toHostedUrl } from "@/lib/kie";
import { writeRoomPrompt, verifyRenderLayout } from "@/lib/kieChat";
import { dataUrlToInline } from "@/lib/image";
import { roomRenderPrompt, kontextRenderPrompt, fallbackRoomPrompt } from "@/lib/prompts";
import { isAllowedReference } from "@/lib/refs";
import { DEFAULT_BRIEF } from "@/lib/styles";
import { renderWithVerification } from "@/lib/verifyLoop";
import type {
  DesignBrief,
  GenerateImageResponse,
  RoomPromptResponse,
  RoomType,
} from "@/lib/types";

// Kontext render + verify + one corrective retry can chain two generations.
export const maxDuration = 300;

// Every generation in this route draws from ONE budget derived from
// maxDuration, with headroom for upload/createTask, the verifier calls and the
// JSON response, so the platform never kills the function mid-poll and an
// already-billed image is never lost.
const ROUTE_BUDGET_MS = maxDuration * 1000 - 20_000;
// Don't start a second render (fallback or corrective retry) with less than
// this left — it could not finish, and would only burn the budget.
const MIN_RENDER_MS = 90_000;

// Cap on the base64 data-URL *string* length (~10MB of characters ≈ ~7MB image).
const MAX_DATA_URL_CHARS = 10 * 1024 * 1024;

type Action = "write" | "render" | "auto";

interface Body {
  action?: Action;
  room?: string; // cropped plan region, base64 data URL
  brief?: DesignBrief;
  roomType?: RoomType;
  prompt?: string; // interior prompt for render/auto
  variation?: number;
  /** Hosted overview URL used as an extra reference (validated to kie.ai hosts). */
  reference?: string;
  /** Eye-level 3D blockout (base64 data URL) used as image-to-image control. */
  blockout?: string;
  /** Detected-layout description used to verify the render (plain text). */
  layout?: string;
}

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Layout-locked render: FLUX.1 Kontext (structure-preserving edit) from the
 * blockout, then a vision-verify pass with one corrective retry
 * (`renderWithVerification`, shared with the static build). Falls back to
 * nano-banana image-to-image if Kontext is unavailable.
 */
async function renderLocked(
  interior: string,
  variation: number,
  brief: DesignBrief,
  blockout: string,
  layout: string | undefined,
  deadline: number,
): Promise<Omit<GenerateImageResponse, "mimeType">> {
  const remaining = () => Math.max(0, deadline - Date.now());
  // Host the blockout ONCE; every generation below reuses the URL instead of
  // re-uploading the multi-MB data URL (and paying for it out of the budget).
  const hosted = await toHostedUrl(blockout, "blockout.png");
  const kontext = async (corrections?: string[]) =>
    (
      await generateKontextImage(kontextRenderPrompt(interior, brief, corrections), hosted, "blockout.png", {
        timeoutMs: remaining(),
      })
    ).imageUrl;

  return renderWithVerification({
    layout,
    // Don't start a second (billed) render the budget can't fit.
    canRetry: () => remaining() >= MIN_RENDER_MS,
    verify: verifyRenderLayout,
    render: async (corrections) => {
      if (corrections) return kontext(corrections);
      try {
        return await kontext();
      } catch (e) {
        // Kontext unavailable → previous behavior (nano-banana img2img), but
        // only when enough budget remains to actually finish it.
        if (remaining() < MIN_RENDER_MS) throw e;
        const { imageUrl } = await generateImage(
          roomRenderPrompt(interior, variation, brief, true),
          [hosted],
          "room.png",
          { timeoutMs: remaining() },
        );
        return imageUrl;
      }
    },
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body.", 400);
  }

  const action: Action = body.action ?? "auto";

  const brief: DesignBrief = { ...DEFAULT_BRIEF, ...(body.brief ?? {}) };
  const roomType: RoomType = body.roomType ?? "auto";
  const variation =
    typeof body.variation === "number" && Number.isFinite(body.variation)
      ? Math.max(0, Math.floor(body.variation))
      : 0;
  // Only forward the reference if it is an https URL on a kie.ai host.
  const reference = isAllowedReference(body.reference) ? body.reference : undefined;

  // Optional eye-level blockout for image-to-image (render/auto). Validate the
  // data URL; ignore (fall back to text-to-image) if it's malformed/oversized.
  let blockout: string | undefined;
  if (typeof body.blockout === "string" && body.blockout) {
    if (body.blockout.length <= MAX_DATA_URL_CHARS && dataUrlToInline(body.blockout)) {
      blockout = body.blockout;
    }
  }
  // Optional expected-layout text for the post-render verification pass.
  const layout =
    typeof body.layout === "string" && body.layout.trim()
      ? body.layout.trim().slice(0, 2000)
      : undefined;

  // The crop is only needed by the prompt writer (write/auto). The render is
  // text-to-image and needs no image.
  const room = body.room;
  if (action !== "render") {
    if (!room || typeof room !== "string") {
      return err("Missing `room` image (cropped data URL).", 400);
    }
    if (room.length > MAX_DATA_URL_CHARS) {
      return err("Room crop is too large (max ~7MB image).", 413);
    }
    if (!dataUrlToInline(room)) {
      return err("`room` must be a base64 image data URL.", 400);
    }
  }

  const deadline = Date.now() + ROUTE_BUDGET_MS;
  const remaining = () => Math.max(1000, deadline - Date.now());

  try {
    // Stage 3a: write (or fall back to a templated prompt). Returns the boxes too
    // so the client can build the eye-level blockout.
    if (action === "write") {
      let prompt: string;
      let boxes: RoomPromptResponse["boxes"] = [];
      let roomSize: RoomPromptResponse["roomSize"] = null;
      try {
        const r = await writeRoomPrompt({ cropDataUrl: room!, brief, roomType, overviewUrl: reference });
        prompt = r.prompt;
        boxes = r.boxes;
        roomSize = r.roomSize;
      } catch {
        // Degrade gracefully so the user can still render.
        prompt = fallbackRoomPrompt(brief, roomType);
      }
      const payload: RoomPromptResponse = { prompt, boxes, roomSize };
      return NextResponse.json(payload);
    }

    // Stage 3b: render. With a blockout it's a layout-locked Kontext edit with a
    // verify/retry pass; without one it's text-to-image.
    if (action === "render") {
      const interior = (body.prompt ?? "").trim() || fallbackRoomPrompt(brief, roomType);
      if (blockout) {
        const result = await renderLocked(interior, variation, brief, blockout, layout, deadline);
        const payload: GenerateImageResponse = { ...result, mimeType: "image/png" };
        return NextResponse.json(payload);
      }
      const { imageUrl } = await generateImage(
        roomRenderPrompt(interior, variation, brief, false),
        [],
        "room.png",
        { timeoutMs: remaining() },
      );
      const payload: GenerateImageResponse = { image: imageUrl, mimeType: "image/png" };
      return NextResponse.json(payload);
    }

    // action === "auto": write (from the crop) then render. The dimension read
    // is skipped: this path never returns roomSize, so it would be paid for and
    // discarded.
    let interior: string;
    try {
      const r = await writeRoomPrompt({
        cropDataUrl: room!,
        brief,
        roomType,
        overviewUrl: reference,
        needRoomSize: false,
      });
      interior = r.prompt;
    } catch {
      interior = fallbackRoomPrompt(brief, roomType);
    }
    if (blockout) {
      const result = await renderLocked(interior, variation, brief, blockout, layout, deadline);
      const payload: GenerateImageResponse & RoomPromptResponse = {
        ...result,
        mimeType: "image/png",
        prompt: interior,
      };
      return NextResponse.json(payload);
    }
    const { imageUrl } = await generateImage(
      roomRenderPrompt(interior, variation, brief, false),
      [],
      "room.png",
      { timeoutMs: remaining() },
    );
    const payload: GenerateImageResponse & RoomPromptResponse = {
      image: imageUrl,
      mimeType: "image/png",
      prompt: interior,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const status = e instanceof KieError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Unknown error.";
    return err(message, status);
  }
}
