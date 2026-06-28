import "server-only";

/**
 * Server-only client for kie.ai's image models (default `nano-banana-2`).
 *
 * kie.ai is an async job API:
 *   1. upload the input image (base64) -> a temporary hosted URL
 *   2. createTask with the prompt + image URL(s) -> taskId
 *   3. poll recordInfo until the task succeeds -> result image URL
 *
 * The API key is read from the environment and never leaves the server.
 */

const MODEL = process.env.KIE_IMAGE_MODEL || "nano-banana-2";
const RESOLUTION = process.env.KIE_IMAGE_RESOLUTION || "1K";

const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
const CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

/** Error carrying an HTTP status so routes can map it to a clean response. */
export class KieError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "KieError";
    this.status = status;
  }
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) {
    throw new KieError(
      "KIE_API_KEY is not set. Copy .env.local.example to .env.local and add your kie.ai key.",
      500,
    );
  }
  return key;
}

/** Public accessor for other server-only kie.ai modules (e.g. lib/kieChat). */
export function requireApiKey(): string {
  return getApiKey();
}

/** kie.ai status code → clean message, shared with other kie.ai modules. */
export function mapKieStatus(code: number, fallback: string): string {
  return messageForCode(code, fallback);
}

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/** Map kie.ai's documented status codes to clean messages. */
function messageForCode(code: number, fallback: string): string {
  switch (code) {
    case 401:
      return "kie.ai authentication failed — check your KIE_API_KEY.";
    case 402:
      return "kie.ai account balance is insufficient to run this generation.";
    case 404:
      return "kie.ai resource not found.";
    case 422:
      return `kie.ai rejected the request parameters: ${fallback}`;
    case 429:
      return "kie.ai rate limit exceeded — please retry in a moment.";
    default:
      return fallback;
  }
}

/**
 * Upload a base64 data URL to kie.ai and return the hosted download URL.
 * `dataUrl` may include the `data:<mime>;base64,` prefix (kie.ai accepts it).
 */
export async function uploadBase64(
  dataUrl: string,
  fileName = "plan.png",
): Promise<string> {
  const key = getApiKey();
  let res: Response;
  try {
    res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        base64Data: dataUrl,
        uploadPath: "planto3d",
        fileName,
      }),
    });
  } catch (err) {
    throw new KieError(
      `Failed to reach kie.ai upload endpoint: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; code?: number; msg?: string; data?: { downloadUrl?: string } }
    | null;

  if (!res.ok || !json) {
    throw new KieError(
      messageForCode(res.status, `Upload failed (HTTP ${res.status}).`),
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
  }
  const url = json.data?.downloadUrl;
  if (!url) {
    throw new KieError(json.msg || "Upload succeeded but returned no URL.");
  }
  return url;
}

/** Create a generation task and return its taskId. */
export async function createTask(
  prompt: string,
  imageUrls: string[],
): Promise<string> {
  const key = getApiKey();
  let res: Response;
  try {
    res = await fetch(CREATE_TASK_URL, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        model: MODEL,
        input: {
          prompt,
          image_input: imageUrls,
          aspect_ratio: "auto",
          resolution: RESOLUTION,
          output_format: "png",
        },
      }),
    });
  } catch (err) {
    throw new KieError(
      `Failed to reach kie.ai createTask: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const json = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { taskId?: string } }
    | null;

  if (!res.ok || !json) {
    throw new KieError(
      messageForCode(res.status, `createTask failed (HTTP ${res.status}).`),
      res.status >= 400 && res.status < 600 ? res.status : 502,
    );
  }
  if (json.code && json.code !== 200) {
    const code = json.code;
    throw new KieError(
      messageForCode(code, json.msg || "createTask failed."),
      code >= 400 && code < 600 ? code : 502,
    );
  }
  const taskId = json.data?.taskId;
  if (!taskId) {
    throw new KieError(json.msg || "createTask returned no taskId.");
  }
  return taskId;
}

interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll recordInfo until the task succeeds; returns the first result URL. */
export async function pollTask(
  taskId: string,
  { timeoutMs = 110_000, intervalMs = 2500 }: PollOptions = {},
): Promise<string> {
  const key = getApiKey();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let res: Response;
    try {
      res = await fetch(
        `${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
    } catch {
      // Transient network blip — wait and retry within the deadline.
      await sleep(intervalMs);
      continue;
    }

    const json = (await res.json().catch(() => null)) as
      | {
          code?: number;
          data?: {
            state?: string;
            resultJson?: string;
            failMsg?: string | null;
            failCode?: string | null;
          };
        }
      | null;

    if (json?.data) {
      const { state, resultJson, failMsg } = json.data;
      if (state === "success") {
        const parsed = safeParse(resultJson);
        const url = parsed?.resultUrls?.[0];
        if (!url) throw new KieError("Task succeeded but returned no image URL.");
        return url;
      }
      if (state === "fail") {
        throw new KieError(failMsg || "Generation failed at kie.ai.");
      }
      // state === "waiting" (or unknown) → keep polling.
    }

    await sleep(intervalMs);
  }

  throw new KieError("Generation timed out. Please try again.", 504);
}

function safeParse(json?: string): { resultUrls?: string[] } | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as { resultUrls?: string[] };
  } catch {
    return null;
  }
}

/**
 * Resolve an input image reference to a hosted URL kie.ai can fetch.
 * Already-hosted `http(s)` URLs (e.g. a previously generated overview) are
 * passed through; base64 data URLs are uploaded first.
 */
async function toHostedUrl(input: string, fileName: string): Promise<string> {
  if (/^https?:\/\//i.test(input)) return input;
  return uploadBase64(input, fileName);
}

/**
 * Full pipeline: resolve each input image to a hosted URL, create a task, and
 * wait for the result. Inputs may be base64 data URLs (uploaded) or existing
 * `http(s)` URLs (passed through). Returns the URL of the generated image.
 */
export async function generateImage(
  prompt: string,
  inputs: string[],
  fileName = "plan.png",
): Promise<{ imageUrl: string }> {
  const imageUrls = await Promise.all(
    inputs.map((input, i) =>
      toHostedUrl(input, inputs.length > 1 ? `${i}-${fileName}` : fileName),
    ),
  );
  const taskId = await createTask(prompt, imageUrls);
  const imageUrl = await pollTask(taskId);
  return { imageUrl };
}
