import "server-only";

import { KieError, requireApiKey, mapKieStatus, uploadBase64 } from "./kie";
import { promptWriterSystem } from "./prompts";
import type { DesignBrief, RoomType } from "./types";

/**
 * Stage 3a — the "prompt writer". Uses kie.ai's OpenAI-compatible chat
 * completions endpoint with a vision-capable Gemini model to turn a cropped
 * floor-plan room + the design brief into a detailed photorealistic interior
 * prompt. Server-only; shares the same KIE_API_KEY.
 *
 * Endpoint shape: https://api.kie.ai/<model>/v1/chat/completions
 */

const CHAT_MODEL = process.env.KIE_CHAT_MODEL || "gemini-2.5-flash";

function chatUrl(): string {
  return `https://api.kie.ai/${CHAT_MODEL}/v1/chat/completions`;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Write a photorealistic interior prompt for the given room crop.
 * `cropDataUrl` is a base64 data URL (uploaded to get a hosted URL first).
 */
export async function writeRoomPrompt(args: {
  cropDataUrl: string;
  brief: DesignBrief;
  roomType: RoomType;
}): Promise<string> {
  const key = requireApiKey();
  const imageUrl = await uploadBase64(args.cropDataUrl, "room.png");
  const system = promptWriterSystem(args.brief, args.roomType);

  let res: Response;
  try {
    res = await fetch(chatUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        stream: false,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Write the photorealistic interior prompt for this room.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    throw new KieError(
      `Failed to reach kie.ai chat endpoint: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new KieError(
      mapKieStatus(res.status, `Prompt generation failed (HTTP ${res.status}).`),
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
  }

  const json = (await res.json().catch(() => null)) as ChatResponse | null;
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new KieError("Prompt generator returned no text.");
  }
  return sanitizePrompt(content);
}

/**
 * Strip common LLM artifacts (surrounding quotes, a leading "Prompt:" label,
 * markdown fences) and cap length so the render step gets a clean prompt.
 */
function sanitizePrompt(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "");
  t = t.replace(/^(prompt|interior prompt)\s*[:\-]\s*/i, "");
  t = t.replace(/^["'""]+/, "").replace(/["'""]+$/, "");
  t = t.trim();
  const MAX = 4000;
  return t.length > MAX ? t.slice(0, MAX) : t;
}
