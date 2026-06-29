import { NextResponse } from "next/server";

import { generateImage, KieError } from "@/lib/kie";
import { writeRoomPrompt } from "@/lib/kieChat";
import { dataUrlToInline } from "@/lib/image";
import { roomRenderPrompt, fallbackRoomPrompt } from "@/lib/prompts";
import { isAllowedReference } from "@/lib/refs";
import { DEFAULT_BRIEF } from "@/lib/styles";
import type {
  DesignBrief,
  GenerateImageResponse,
  RoomPromptResponse,
  RoomType,
} from "@/lib/types";

export const maxDuration = 120;

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
}

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

  try {
    // Stage 3a: write (or fall back to a templated prompt). Returns the boxes too
    // so the client can build the eye-level blockout.
    if (action === "write") {
      let prompt: string;
      let boxes: RoomPromptResponse["boxes"] = [];
      try {
        const r = await writeRoomPrompt({ cropDataUrl: room!, brief, roomType, overviewUrl: reference });
        prompt = r.prompt;
        boxes = r.boxes;
      } catch {
        // Degrade gracefully so the user can still render.
        prompt = fallbackRoomPrompt(brief, roomType);
      }
      const payload: RoomPromptResponse = { prompt, boxes };
      return NextResponse.json(payload);
    }

    // Stage 3b: render. With a blockout it's image-to-image (layout-locked);
    // without one it's text-to-image.
    if (action === "render") {
      const interior = (body.prompt ?? "").trim() || fallbackRoomPrompt(brief, roomType);
      const { imageUrl } = await generateImage(
        roomRenderPrompt(interior, variation, brief, Boolean(blockout)),
        blockout ? [blockout] : [],
        "room.png",
      );
      const payload: GenerateImageResponse = { image: imageUrl, mimeType: "image/png" };
      return NextResponse.json(payload);
    }

    // action === "auto": write (from the crop) then render.
    let interior: string;
    try {
      const r = await writeRoomPrompt({ cropDataUrl: room!, brief, roomType, overviewUrl: reference });
      interior = r.prompt;
    } catch {
      interior = fallbackRoomPrompt(brief, roomType);
    }
    const { imageUrl } = await generateImage(
      roomRenderPrompt(interior, variation, brief, Boolean(blockout)),
      blockout ? [blockout] : [],
      "room.png",
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
