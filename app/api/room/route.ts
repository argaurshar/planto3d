import { NextResponse } from "next/server";

import { generateImage, KieError } from "@/lib/kie";
import { dataUrlToInline } from "@/lib/image";
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

  if (!dataUrlToInline(room)) {
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
    const { imageUrl } = await generateImage(roomPrompt(variation), [room], "room.png");
    const payload: GenerateImageResponse = {
      image: imageUrl,
      mimeType: "image/png",
    };
    return NextResponse.json(payload);
  } catch (err) {
    const status = err instanceof KieError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status });
  }
}
