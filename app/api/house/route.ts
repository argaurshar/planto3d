import { NextResponse } from "next/server";

import { KieError } from "@/lib/kie";
import { detectHouse } from "@/lib/kieChat";
import { dataUrlToInline } from "@/lib/image";
import type { HouseResponse } from "@/lib/types";

// One vision call (plus at most one retry) over the whole plan.
export const maxDuration = 120;

// Cap on the base64 data-URL *string* length (~10MB of characters ≈ ~7MB image).
const MAX_DATA_URL_CHARS = 10 * 1024 * 1024;

/**
 * Stage 0: read the WHOLE plan into one model — every room (with its printed
 * dimensions), every door and window, every furniture item — in one 0-1000
 * frame (lib/house.ts). The client snaps and scales it (`finalizeHouse`)
 * because only it knows the plan image's pixel aspect.
 */
export async function POST(req: Request) {
  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const plan = body.plan;
  if (!plan || typeof plan !== "string") {
    return NextResponse.json({ error: "Missing `plan` image (data URL)." }, { status: 400 });
  }
  if (plan.length > MAX_DATA_URL_CHARS) {
    return NextResponse.json({ error: "Plan image is too large (max ~7MB image)." }, { status: 413 });
  }
  if (!dataUrlToInline(plan)) {
    return NextResponse.json({ error: "`plan` must be a base64 image data URL." }, { status: 400 });
  }
  try {
    const house = await detectHouse(plan);
    const payload: HouseResponse = { house };
    return NextResponse.json(payload);
  } catch (err) {
    const status = err instanceof KieError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status });
  }
}
