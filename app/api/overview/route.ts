import { NextResponse } from "next/server";

import { generateImage, GeminiError } from "@/lib/gemini";
import { dataUrlToInline, inlineToDataUrl } from "@/lib/image";
import { overviewPrompt } from "@/lib/prompts";
import type { GenerateImageResponse } from "@/lib/types";

// Image generation can take a while; allow a generous timeout.
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // ~10MB of base64

export async function POST(req: Request) {
  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const plan = body.plan;
  if (!plan || typeof plan !== "string") {
    return NextResponse.json(
      { error: "Missing `plan` image (data URL)." },
      { status: 400 },
    );
  }
  if (plan.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Plan image is too large (max ~7MB)." },
      { status: 413 },
    );
  }

  const inline = dataUrlToInline(plan);
  if (!inline) {
    return NextResponse.json(
      { error: "`plan` must be a base64 image data URL." },
      { status: 400 },
    );
  }

  try {
    const result = await generateImage(overviewPrompt(), [inline]);
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
