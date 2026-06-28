import { NextResponse } from "next/server";

import { generateImage, KieError } from "@/lib/kie";
import { dataUrlToInline } from "@/lib/image";
import { overviewPrompt } from "@/lib/prompts";
import type { GenerateImageResponse } from "@/lib/types";

// Image generation is async at kie.ai (create + poll); allow a generous timeout.
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

  if (!dataUrlToInline(plan)) {
    return NextResponse.json(
      { error: "`plan` must be a base64 image data URL." },
      { status: 400 },
    );
  }

  try {
    const { imageUrl } = await generateImage(overviewPrompt(), [plan], "plan.png");
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
