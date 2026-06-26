import { NextResponse } from "next/server";

import { generateImage, GeminiError } from "@/lib/gemini";
import { dataUrlToInline, inlineToDataUrl } from "@/lib/image";
import { roomPrompt } from "@/lib/prompts";
import type { GenerateImageResponse } from "@/lib/types";

export const maxDuration = 120;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  let body: { room?: string; variation?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const room = body.room;
  if (!room || typeof room !== "string") {
    return NextResponse.json(
      { error: "Missing `room` image (cropped data URL)." },
      { status: 400 },
    );
  }
  if (room.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Room crop is too large." },
      { status: 413 },
    );
  }

  const inline = dataUrlToInline(room);
  if (!inline) {
    return NextResponse.json(
      { error: "`room` must be a base64 image data URL." },
      { status: 400 },
    );
  }

  const variation =
    typeof body.variation === "number" && Number.isFinite(body.variation)
      ? Math.max(0, Math.floor(body.variation))
      : 0;

  try {
    const result = await generateImage(roomPrompt(variation), [inline]);
    const payload: GenerateImageResponse = {
      image: inlineToDataUrl(result),
      mimeType: result.mimeType,
    };
    return NextResponse.json(payload);
  } catch (err) {
    const status = err instanceof GeminiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status });
  }
}
