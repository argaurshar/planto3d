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

import {
  promptWriterSystem,
  roomRenderPrompt,
  layoutVerifierSystem,
  parseVerifierReply,
} from "./prompts";
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
import {
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  pollTimeoutMessage,
  transientFailGate,
} from "./kiePoll";

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
  return process.env.NEXT_PUBLIC_KIE_CHAT_MODEL || "gemini-3-flash";
}
function detectModel(): string {
  return process.env.NEXT_PUBLIC_KIE_DETECT_MODEL || "gemini-3-pro";
}
function kontextModel(): string {
  return process.env.NEXT_PUBLIC_KIE_KONTEXT_MODEL || "flux-kontext-max";
}

const KONTEXT_GENERATE_URL = "https://api.kie.ai/api/v1/flux/kontext/generate";
const KONTEXT_RECORD_URL = "https://api.kie.ai/api/v1/flux/kontext/record-info";

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
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const gate = transientFailGate();
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
      if (d?.state === "fail") {
        // Transient "generate task timeout" is tolerated for a grace window;
        // anything else, or a fail that persists, surfaces the real message.
        if (!gate.tolerate(d.failMsg)) throw new Error(d.failMsg || "Generation failed at kie.ai.");
      } else {
        gate.reset();
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(pollTimeoutMessage("Generation"));
}

/** Resolve data URLs (uploaded) or http(s) URLs (passed through) to hosted URLs. */
export async function toHostedUrl(input: string, apiKey: string, fileName: string): Promise<string> {
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

/** First plausible image URL anywhere in a kontext record-info payload. */
function extractImageUrl(payload: unknown): string | null {
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return null;
  }
  const urls = text.match(/https?:\/\/[^"\\\s]+/g) ?? [];
  const image = urls.find((u) => /\.(png|jpe?g|webp)(\?|$)/i.test(u));
  return image ?? urls[0] ?? null;
}

/**
 * Render via FLUX.1 Kontext (structure-preserving edit): the input image (our
 * eye-level blockout) fixes the composition; the prompt says what to make it.
 */
export async function generateKontextImageBrowser(
  prompt: string,
  input: string,
  apiKey: string,
  fileName = "blockout.png",
): Promise<string> {
  const inputImage = await toHostedUrl(input, apiKey, fileName);
  const res = await fetch(KONTEXT_GENERATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      inputImage,
      model: kontextModel(),
      aspectRatio: "4:3",
      outputFormat: "png",
      enableTranslation: false,
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { taskId?: string } }
    | null;
  if (!res.ok || !json || (json.code && json.code !== 200) || !json.data?.taskId) {
    const code = json?.code ?? res.status;
    throw new Error(friendly(code, json?.msg || `Kontext generate failed (HTTP ${res.status}).`));
  }

  const taskId = json.data.taskId;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const gate = transientFailGate();
  while (Date.now() < deadline) {
    const poll = await fetch(`${KONTEXT_RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => null);
    if (poll?.ok) {
      const info = (await poll.json().catch(() => null)) as
        | { data?: { successFlag?: number; errorMessage?: string | null; response?: unknown } }
        | null;
      const d = info?.data;
      if (d) {
        if (d.successFlag === 1) {
          const url = extractImageUrl(d.response ?? d);
          if (url) return url;
          throw new Error("Kontext task succeeded but returned no image URL.");
        }
        if (d.successFlag === 2 || d.successFlag === 3) {
          if (!gate.tolerate(d.errorMessage)) {
            throw new Error(d.errorMessage || "Kontext generation failed at kie.ai.");
          }
        } else {
          gate.reset();
        }
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(pollTimeoutMessage("The room render"));
}

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** POST a single (system + user) turn to the kie.ai chat endpoint, return text. */
async function chatComplete(
  system: string,
  userContent: ChatContent[],
  apiKey: string,
  model: string = chatModel(),
): Promise<string> {
  const res = await fetch(`https://api.kie.ai/${model}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
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

async function detectOnceBrowser(
  imageUrl: string,
  apiKey: string,
  system: string,
): Promise<SpatialBox[]> {
  const content = await chatComplete(
    system,
    [
      { type: "text", text: "Detect the objects in this room." },
      { type: "image_url", image_url: { url: imageUrl } },
    ],
    apiKey,
    detectModel(),
  );
  const boxes = parseSpatialBoxes(content);
  if (typeof console !== "undefined") {
    console.debug(
      "[voxa] detection: reply",
      (content || "").length,
      "chars →",
      boxes.length,
      "boxes",
      boxes.length ? `(${boxes.map((b) => b.label).join(", ")})` : "",
    );
  }
  return boxes;
}

/**
 * Read the plan crop's printed room dimensions. Best-effort; null on failure.
 * This is text reading, not spatial reasoning, so it runs on the cheaper chat
 * model rather than the detection model.
 */
async function detectRoomSizeBrowser(
  imageUrl: string,
  apiKey: string,
): Promise<RoomSize | null> {
  try {
    const content = await chatComplete(
      ROOM_DIMENSION_PROMPT,
      [
        { type: "text", text: "Read this room's printed dimensions." },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
      apiKey,
      chatModel(),
    );
    return parseRoomDimensions(content);
  } catch {
    return null;
  }
}

/** Best-effort spatial detection on the room crop → { layout, boxes } ([] on failure). */
async function detectLayoutBrowser(
  imageUrl: string,
  apiKey: string,
): Promise<{ layout: string; boxes: SpatialBox[] }> {
  try {
    let boxes = await detectOnceBrowser(imageUrl, apiKey, SPATIAL_EXTRACTION_PROMPT);
    if (boxes.length < 2) {
      const retry = await detectOnceBrowser(imageUrl, apiKey, SPATIAL_RETRY_PROMPT).catch(() => []);
      if (retry.length > boxes.length) boxes = retry;
    }
    return { layout: describeLayout(boxes), boxes };
  } catch (e) {
    if (typeof console !== "undefined") console.debug("[voxa] detection failed:", e);
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
}): Promise<{ prompt: string; boxes: SpatialBox[]; roomSize: RoomSize | null }> {
  const imageUrl = await uploadBase64(args.cropDataUrl, args.apiKey, "room.png");
  // Detection and the dimension read are independent — run them concurrently.
  const [{ layout, boxes }, roomSize] = await Promise.all([
    detectLayoutBrowser(imageUrl, args.apiKey),
    detectRoomSizeBrowser(imageUrl, args.apiKey),
  ]);
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
  return { prompt, boxes, roomSize };
}

/**
 * Verify a finished render against the expected layout (browser). Best-effort:
 * returns null when the check can't run, so callers just skip verification.
 */
export async function verifyRenderLayoutBrowser(
  imageUrl: string,
  expectedLayout: string,
  apiKey: string,
): Promise<{ matches: boolean; problems: string[] } | null> {
  try {
    const content = await chatComplete(
      layoutVerifierSystem(),
      [
        { type: "text", text: `EXPECTED LAYOUT:\n${expectedLayout}` },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
      apiKey,
    );
    return parseVerifierReply(content);
  } catch {
    return null;
  }
}

// Re-exported so api.ts can build prompts identically to the server path.
export { roomRenderPrompt };
