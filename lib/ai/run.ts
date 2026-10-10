// The three AI jobs, for either provider. Isomorphic: the browser calls these
// directly with the user's key (static build), the /api/ai route calls them
// with the server's key (server build).

import type { RoomModel, Shot } from "../room/types";
import { parseJsonObject, type PlanReading } from "../room/read";
import { geminiImage, geminiText, googleModels, isGoogleKey, dataUrlPart } from "./google";
import { KIE_MODELS, kieChat, kieImage, kieUpload } from "./kie";
import { COMMAND_SYSTEM, PLAN_READER_SYSTEM, commandUser, planReaderUser, realisticPrompt } from "./prompts";

export interface Provider {
  kind: "google" | "kie";
  key: string;
}

export function providerFor(key: string): Provider {
  return { kind: isGoogleKey(key) ? "google" : "kie", key: key.trim() };
}

export function providerLabel(p: Provider | null): string {
  return p?.kind === "google" ? "Google Gemini" : p?.kind === "kie" ? "kie.ai" : "AI";
}

/** Read a plan image (data URL) into boxes + printed numbers. One retry on unreadable JSON. */
export async function runReadPlan(p: Provider, image: string, hint?: string): Promise<PlanReading> {
  const ask = async (): Promise<string> => {
    if (p.kind === "google") {
      const m = await googleModels(p.key);
      try {
        return await geminiText(p.key, m.reader, PLAN_READER_SYSTEM, [dataUrlPart(image), { text: planReaderUser(hint) }], { json: true, temperature: 0.1 });
      } catch (e) {
        if (m.reader === m.fast || !(e instanceof Error) || !/not found|not allowed|quota|rate/i.test(e.message)) throw e;
        return geminiText(p.key, m.fast, PLAN_READER_SYSTEM, [dataUrlPart(image), { text: planReaderUser(hint) }], { json: true, temperature: 0.1 });
      }
    }
    const url = await kieUpload(image, p.key, `plan-${Date.now()}.png`);
    return kieChat(p.key, KIE_MODELS.reader(), PLAN_READER_SYSTEM, planReaderUser(hint), [url]);
  };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reading = parseJsonObject<PlanReading>(await ask());
      if (reading && (reading.room_box || reading.items?.length || reading.openings?.length)) return reading;
      lastErr = new Error("The AI could not find a room on this image.");
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && !/JSON|Unexpected|position/i.test(e.message)) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("The plan could not be read.");
}

/** A command the local parser did not understand → proposed operations (validated by the caller). */
export async function runCommand(p: Provider, room: RoomModel, text: string, selectedId: string | null): Promise<{ ops: unknown; reply: string }> {
  const user = commandUser(room, text, selectedId);
  const answer =
    p.kind === "google"
      ? await geminiText(p.key, (await googleModels(p.key)).fast, COMMAND_SYSTEM, [{ text: user }], { json: true, temperature: 0.2 })
      : await kieChat(p.key, KIE_MODELS.fast(), COMMAND_SYSTEM, user);
  const json = parseJsonObject<{ ops?: unknown; reply?: unknown }>(answer);
  return { ops: json.ops ?? [], reply: typeof json.reply === "string" ? json.reply.slice(0, 300) : "" };
}

/** Raw shot (data URL) → photoreal image (data URL from Google, https URL from kie.ai). */
export async function runRealistic(p: Provider, room: RoomModel, shot: Shot | null, image: string, extra = ""): Promise<string> {
  const prompt = realisticPrompt(room, shot, extra);
  if (p.kind === "google") {
    const m = await googleModels(p.key);
    return geminiImage(p.key, m.image, prompt, [image], { aspectRatio: "4:3", size: "2K" });
  }
  return kieImage(p.key, prompt, [image], "4:3");
}
