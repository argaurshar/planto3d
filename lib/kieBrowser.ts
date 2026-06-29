// Browser-side kie.ai client for the STATIC (GitHub Pages) build.
//
// In the static build there is no server, so generation must run in the
// browser using a user-supplied key (entered in the UI, stored in
// localStorage — never committed). This mirrors lib/kie.ts + lib/kieChat.ts but
// takes the API key as a parameter and has no `server-only` import.
//
// NOTE: whether these calls succeed from a browser depends on kie.ai sending
// permissive CORS headers. If they don't, the UI still loads but generation
// will fail with a network/CORS error — use the server build (Vercel) instead.

import { promptWriterSystem, roomRenderPrompt } from "./prompts";
import { SPATIAL_EXTRACTION_PROMPT, parseSpatialBoxes, describeLayout } from "./spatial";
import type { SpatialBox } from "./spatial";
import type { DesignBrief, RoomType } from "./types";

const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
const CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

function imageModel(): string {
  return process.env.NEXT_PUBLIC_KIE_IMAGE_MODEL || "nano-banana-2";
}
function imageResolution(): string {
  return process.env.NEXT_PUBLIC_KIE_IMAGE_RESOLUTION || "1K";
}
function chatModel(): string {
  return process.env.NEXT_PUBLIC_KIE_CHAT_MODEL || "gemini-2.5-flash";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return "kie.ai authentication failed — check your API key.";
    case 402:
      return "kie.ai balance is insufficient to run this generation.";
    case 429:
      return "kie.ai rate limit exceeded — please retry in a moment.";
    default:
      return fallback;
  }
}

async function uploadBase64(dataUrl: string, apiKey: string, fileName: string): Promise<string> {
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data: dataUrl, uploadPath: "planto3d", fileName }),
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: { downloadUrl?: string }; msg?: string }
    | null;
  if (!res.ok || !json?.data?.downloadUrl) {
    throw new Error(friendly(res.status, json?.msg || `Upload failed (HTTP ${res.status}).`));
  }
  return json.data.downloadUrl;
}

async function createTask(prompt: string, imageUrls: string[], apiKey: string): Promise<string> {
  const res = await fetch(CREATE_TASK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: imageModel(),
      input: {
        prompt,
        image_input: imageUrls,
        aspect_ratio: "auto",
        resolution: imageResolution(),
        output_format: "png",
      },
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { taskId?: string } }
    | null;
  if (!res.ok || (json?.code && json.code !== 200) || !json?.data?.taskId) {
    const code = json?.code ?? res.status;
    throw new Error(friendly(code, json?.msg || `createTask failed (HTTP ${res.status}).`));
  }
  return json.data.taskId;
}

async function pollTask(taskId: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json().catch(() => null)) as
        | { data?: { state?: string; resultJson?: string; failMsg?: string | null } }
        | null;
      const d = json?.data;
      if (d?.state === "success") {
        try {
          const url = (JSON.parse(d.resultJson || "{}") as { resultUrls?: string[] }).resultUrls?.[0];
          if (url) return url;
        } catch {
          /* fall through */
        }
        throw new Error("Task succeeded but returned no image URL.");
      }
      if (d?.state === "fail") throw new Error(d.failMsg || "Generation failed at kie.ai.");
    }
    await sleep(2500);
  }
  throw new Error("Generation timed out. Please try again.");
}

/** Resolve data URLs (uploaded) or http(s) URLs (passed through) to hosted URLs. */
async function toHostedUrl(input: string, apiKey: string, fileName: string): Promise<string> {
  if (/^https?:\/\//i.test(input)) return input;
  return uploadBase64(input, apiKey, fileName);
}

/** Generate an image from a prompt + input images (data URLs or http URLs). */
export async function generateImageBrowser(
  prompt: string,
  inputs: string[],
  apiKey: string,
  fileName = "plan.png",
): Promise<string> {
  const urls = await Promise.all(
    inputs.map((i, idx) => toHostedUrl(i, apiKey, inputs.length > 1 ? `${idx}-${fileName}` : fileName)),
  );
  const taskId = await createTask(prompt, urls, apiKey);
  return pollTask(taskId, apiKey);
}

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** POST a single (system + user) turn to the kie.ai chat endpoint, return text. */
async function chatComplete(
  system: string,
  userContent: ChatContent[],
  apiKey: string,
): Promise<string> {
  const res = await fetch(`https://api.kie.ai/${chatModel()}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatModel(),
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(friendly(res.status, `Prompt generation failed (HTTP ${res.status}).`));
  }
  const json = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[] }
    | null;
  return json?.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Best-effort spatial detection on the room crop → { layout, boxes } ([] on failure). */
async function detectLayoutBrowser(
  imageUrl: string,
  apiKey: string,
): Promise<{ layout: string; boxes: SpatialBox[] }> {
  try {
    const content = await chatComplete(
      SPATIAL_EXTRACTION_PROMPT,
      [
        { type: "text", text: "Detect the objects in this room." },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
      apiKey,
    );
    const boxes = parseSpatialBoxes(content);
    return { layout: describeLayout(boxes), boxes };
  } catch {
    return { layout: "", boxes: [] };
  }
}

/**
 * Stage 3a in the browser: write an interior prompt from a room crop, plus the
 * detected boxes (for the eye-level blockout).
 */
export async function writeRoomPromptBrowser(args: {
  cropDataUrl: string;
  brief: DesignBrief;
  roomType: RoomType;
  apiKey: string;
  /** Optional hosted overview URL for whole-home style consistency. */
  overviewUrl?: string;
}): Promise<{ prompt: string; boxes: SpatialBox[] }> {
  const imageUrl = await uploadBase64(args.cropDataUrl, args.apiKey, "room.png");
  const { layout, boxes } = await detectLayoutBrowser(imageUrl, args.apiKey);
  const hasOverview = Boolean(args.overviewUrl);

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

  const content = await chatComplete(
    promptWriterSystem(args.brief, args.roomType, hasOverview, Boolean(layout)),
    userContent,
    args.apiKey,
  );
  if (!content) throw new Error("Prompt generator returned no text.");
  const prompt = content
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(prompt|interior prompt)\s*[:\-]\s*/i, "")
    .replace(/^["'""]+/, "")
    .replace(/["'""]+$/, "")
    .trim()
    .slice(0, 4000);
  return { prompt, boxes };
}

// Re-exported so api.ts can build prompts identically to the server path.
export { roomRenderPrompt };
