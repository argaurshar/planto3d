import { NextResponse } from "next/server";

import { generateImage, KieError } from "@/lib/kie";
import { writeRoomPrompt } from "@/lib/kieChat";
import { dataUrlToInline } from "@/lib/image";
import { roomRenderPrompt, fallbackRoomPrompt } from "@/lib/prompts";
import { DEFAULT_BRIEF } from "@/lib/styles";
import type {
  DesignBrief,
  GenerateImageResponse,
  RoomPromptResponse,
  RoomType,
} from "@/lib/types";

export const maxDuration = 120;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type Action = "write" | "render" | "auto";

interface Body {
  action?: Action;
  room?: string; // cropped plan region, base64 data URL
  brief?: DesignBrief;
  roomType?: RoomType;
  prompt?: string; // interior prompt for render/auto
  variation?: number;
  /** Optional already-hosted reference image (e.g. the approved overview). */
  reference?: string;
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

  const room = body.room;
  if (!room || typeof room !== "string") {
    return err("Missing `room` image (cropped data URL).", 400);
  }
  if (room.length > MAX_IMAGE_BYTES) {
    return err("Room crop is too large.", 413);
  }
  if (!dataUrlToInline(room)) {
    return err("`room` must be a base64 image data URL.", 400);
  }

  const brief: DesignBrief = { ...DEFAULT_BRIEF, ...(body.brief ?? {}) };
  const roomType: RoomType = body.roomType ?? "auto";
  const variation =
    typeof body.variation === "number" && Number.isFinite(body.variation)
      ? Math.max(0, Math.floor(body.variation))
      : 0;

  try {
    // Stage 3a: write (or fall back to a templated prompt).
    if (action === "write") {
      let prompt: string;
      try {
        prompt = await writeRoomPrompt({ cropDataUrl: room, brief, roomType });
      } catch {
        // Degrade gracefully so the user can still render.
        prompt = fallbackRoomPrompt(brief, roomType);
      }
      const payload: RoomPromptResponse = { prompt };
      return NextResponse.json(payload);
    }

    // Stage 3b: render from a provided prompt.
    if (action === "render") {
      const interior = (body.prompt ?? "").trim() || fallbackRoomPrompt(brief, roomType);
      const inputs = [room];
      if (body.reference && /^https?:\/\//i.test(body.reference)) {
        inputs.push(body.reference);
      }
      const { imageUrl } = await generateImage(
        roomRenderPrompt(interior, variation),
        inputs,
        "room.png",
      );
      const payload: GenerateImageResponse = { image: imageUrl, mimeType: "image/png" };
      return NextResponse.json(payload);
    }

    // action === "auto": write then render in one call.
    let interior: string;
    try {
      interior = await writeRoomPrompt({ cropDataUrl: room, brief, roomType });
    } catch {
      interior = fallbackRoomPrompt(brief, roomType);
    }
    const inputs = [room];
    if (body.reference && /^https?:\/\//i.test(body.reference)) {
      inputs.push(body.reference);
    }
    const { imageUrl } = await generateImage(
      roomRenderPrompt(interior, variation),
      inputs,
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
