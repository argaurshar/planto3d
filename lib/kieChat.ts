import "server-only";

import { KieError, requireApiKey, mapKieStatus, uploadBase64 } from "./kie";
import { promptWriterSystem, layoutVerifierSystem, parseVerifierReply } from "./prompts";
import {
  SPATIAL_EXTRACTION_PROMPT,
  SPATIAL_RETRY_PROMPT,
  ROOM_DIMENSION_PROMPT,
  parseSpatialBoxes,
  parseRoomDimensions,
  describeLayout,
} from "./spatial";
import type { SpatialBox, RoomSize } from "./spatial";
import type { DesignBrief, RoomType } from "./types";

/**
 * Stage 3a — the "prompt writer". Uses kie.ai's OpenAI-compatible chat
 * completions endpoint with a vision-capable Gemini model to turn a cropped
 * floor-plan room + the design brief into a detailed photorealistic interior
 * prompt. Server-only; shares the same KIE_API_KEY.
 *
 * Endpoint shape: https://api.kie.ai/<model>/v1/chat/completions
 */

const CHAT_MODEL = process.env.KIE_CHAT_MODEL || "gemini-3-flash";
// Detection benefits from a stronger spatial model than the prompt writer.
const DETECT_MODEL = process.env.KIE_DETECT_MODEL || "gemini-3-pro";

function chatUrl(model: string): string {
  return `https://api.kie.ai/${model}/v1/chat/completions`;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** POST a single (system + user) turn to the kie.ai chat endpoint, return text. */
async function chatComplete(
  system: string,
  userContent: ChatContent[],
  key: string,
  model: string = CHAT_MODEL,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(chatUrl(model), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
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
  return json?.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Stage 3a spatial grounding: run an object-detection pass on the room crop and
 * return the detected boxes (for the client 3D blockout) plus a natural-language
 * layout string (for the prompt). Best-effort — never throws (the prompt writer
 * degrades to today's behavior on failure).
 */
async function detectOnce(imageUrl: string, key: string, system: string): Promise<SpatialBox[]> {
  const content = await chatComplete(
    system,
    [
      { type: "text", text: "Detect the objects in this room." },
      { type: "image_url", image_url: { url: imageUrl } },
    ],
    key,
    DETECT_MODEL,
  );
  return parseSpatialBoxes(content);
}

/**
 * Read the room's printed dimensions off the plan crop. Best-effort: any
 * failure returns null and the blockout falls back to its aspect heuristic.
 * This is text reading, not spatial reasoning, so it runs on the cheaper
 * CHAT_MODEL rather than DETECT_MODEL.
 */
async function detectRoomSize(imageUrl: string, key: string): Promise<RoomSize | null> {
  try {
    const content = await chatComplete(
      ROOM_DIMENSION_PROMPT,
      [
        { type: "text", text: "Read this room's printed dimensions." },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
      key,
    );
    return parseRoomDimensions(content);
  } catch {
    return null;
  }
}

async function detectLayout(
  imageUrl: string,
  key: string,
): Promise<{ layout: string; boxes: SpatialBox[] }> {
  try {
    let boxes = await detectOnce(imageUrl, key, SPATIAL_EXTRACTION_PROMPT);
    // A furnished room with <2 detections almost always means under-detection;
    // try once more with a more forceful instruction and keep the better result.
    if (boxes.length < 2) {
      const retry = await detectOnce(imageUrl, key, SPATIAL_RETRY_PROMPT).catch(() => []);
      if (retry.length > boxes.length) boxes = retry;
    }
    return { layout: describeLayout(boxes), boxes };
  } catch {
    return { layout: "", boxes: [] };
  }
}

/**
 * Write a photorealistic interior prompt for the given room crop, plus the
 * detected spatial boxes (used by the client to build the eye-level blockout).
 * `cropDataUrl` is a base64 data URL (uploaded to get a hosted URL first).
 */
export async function writeRoomPrompt(args: {
  cropDataUrl: string;
  brief: DesignBrief;
  roomType: RoomType;
  /** Optional hosted overview URL for whole-home style consistency. */
  overviewUrl?: string;
  /** Skip the paid dimension read when the caller won't use `roomSize`. */
  needRoomSize?: boolean;
}): Promise<{ prompt: string; boxes: SpatialBox[]; roomSize: RoomSize | null }> {
  const key = requireApiKey();
  const imageUrl = await uploadBase64(args.cropDataUrl, "room.png");

  // Stage 3a.0: ground the prompt in a detected layout of the crop, and read the
  // plan's printed dimensions so the blockout is built at the real room scale.
  // Both are best-effort and independent, so run them concurrently.
  const [{ layout, boxes }, roomSize] = await Promise.all([
    detectLayout(imageUrl, key),
    args.needRoomSize === false ? Promise.resolve(null) : detectRoomSize(imageUrl, key),
  ]);
  const hasOverview = Boolean(args.overviewUrl);
  const system = promptWriterSystem(args.brief, args.roomType, hasOverview, Boolean(layout));

  const userContent: ChatContent[] = [
    { type: "text", text: "Write the photorealistic interior prompt for this room." },
  ];
  if (layout) {
    userContent.push({ type: "text", text: `DETECTED SPATIAL LAYOUT:\n${layout}` });
  }
  userContent.push({ type: "image_url", image_url: { url: imageUrl } });
  if (args.overviewUrl) {
    userContent.push({ type: "image_url", image_url: { url: args.overviewUrl } });
  }

  const content = await chatComplete(system, userContent, key);
  if (!content) {
    throw new KieError("Prompt generator returned no text.");
  }
  return { prompt: sanitizePrompt(content), boxes, roomSize };
}

/**
 * Verify a finished render against the expected layout with the vision LLM.
 * Best-effort: returns null when the check can't run (caller skips verification).
 */
export async function verifyRenderLayout(
  imageUrl: string,
  expectedLayout: string,
): Promise<{ matches: boolean; problems: string[] } | null> {
  try {
    const content = await chatComplete(
      layoutVerifierSystem(),
      [
        { type: "text", text: `EXPECTED LAYOUT:\n${expectedLayout}` },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
      requireApiKey(),
    );
    return parseVerifierReply(content);
  } catch {
    return null;
  }
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
