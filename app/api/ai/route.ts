import { NextResponse } from "next/server";

import { providerFor, runCommand, runReadPlan, runRealistic } from "@/lib/ai/run";
import type { RoomModel, Shot } from "@/lib/room/types";

// Server build only: AI jobs with the server's own key, for visitors who have
// not saved a key in their browser. (The static build calls the providers
// directly from the browser with the visitor's key.)
export const maxDuration = 300;

const MAX_IMAGE_CHARS = 14 * 1024 * 1024;

function serverKey(): string | null {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.KIE_API_KEY || null;
}

function isImage(v: unknown): v is string {
  return typeof v === "string" && v.length < MAX_IMAGE_CHARS && /^data:image\/(png|jpe?g|webp);base64,/.test(v);
}

function isRoom(v: unknown): v is RoomModel {
  const r = v as RoomModel;
  return !!r && typeof r === "object" && typeof r.width === "number" && typeof r.depth === "number" && Array.isArray(r.items) && Array.isArray(r.openings) && r.items.length <= 200;
}

export async function POST(req: Request) {
  const key = serverKey();
  if (!key) {
    return NextResponse.json({ error: "No AI key on the server. Add your Google AI Studio or kie.ai key at the bottom of the page." }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const p = providerFor(key);
  try {
    switch (body.task) {
      case "read": {
        if (!isImage(body.image)) return NextResponse.json({ error: "`image` must be a PNG/JPEG data URL under ~10 MB." }, { status: 400 });
        const reading = await runReadPlan(p, body.image, typeof body.hint === "string" ? body.hint : undefined);
        return NextResponse.json({ reading });
      }
      case "command": {
        if (!isRoom(body.room) || typeof body.text !== "string") return NextResponse.json({ error: "Missing room or text." }, { status: 400 });
        const out = await runCommand(p, body.room, body.text.slice(0, 500), typeof body.selected === "string" ? body.selected : null);
        return NextResponse.json(out);
      }
      case "render": {
        if (!isRoom(body.room) || !isImage(body.image)) return NextResponse.json({ error: "Missing room or shot image." }, { status: 400 });
        const image = await runRealistic(p, body.room, (body.shot as Shot) ?? null, body.image, typeof body.extra === "string" ? body.extra : "");
        return NextResponse.json({ image });
      }
      default:
        return NextResponse.json({ error: "Unknown task." }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed.";
    const status = /key|not allowed|rejected/i.test(message) ? 401 : /quota|rate|balance/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
