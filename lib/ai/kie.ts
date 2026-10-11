// kie.ai client (the user's kie.ai key). Isomorphic: plain fetch, the key is a
// parameter. kie.ai proxies Gemini chat models (plan reading, commands) and
// Google's Nano Banana image models (realistic render) behind one key.
//
// kie.ai's image jobs are asynchronous and take hosted image URLs, so an image
// goes up through the file upload first, then a task is created and polled.

import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS, pollTimeoutMessage, transientFailGate } from "./kiePoll";

const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";
const CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";

const env = (name: string): string | undefined =>
  (typeof process !== "undefined" ? process.env[name] || process.env[`NEXT_PUBLIC_${name}`] : undefined) || undefined;

export const KIE_MODELS = {
  reader: () => env("KIE_READER_MODEL") ?? "gemini-3-pro",
  fast: () => env("KIE_CHAT_MODEL") ?? "gemini-3-flash",
  image: () => env("KIE_RENDER_MODEL") ?? "nano-banana-pro",
  resolution: () => env("KIE_RENDER_RESOLUTION") ?? "2K",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function friendly(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return "kie.ai rejected the API key — check it at kie.ai/api-key.";
    case 402:
      return "kie.ai balance is too low for this — top up at kie.ai.";
    case 429:
      return "kie.ai rate limit — try again in a moment.";
    default:
      return fallback;
  }
}

export async function kieUpload(dataUrl: string, key: string, fileName: string): Promise<string> {
  if (/^https?:\/\//i.test(dataUrl)) return dataUrl;
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data: dataUrl, uploadPath: "planto3d", fileName }),
  });
  const json = (await res.json().catch(() => null)) as { data?: { downloadUrl?: string }; msg?: string } | null;
  if (!res.ok || !json?.data?.downloadUrl) throw new Error(friendly(res.status, json?.msg || `Upload to kie.ai failed (HTTP ${res.status}).`));
  return json.data.downloadUrl;
}

async function createJob(model: string, input: Record<string, unknown>, key: string): Promise<string> {
  const res = await fetch(CREATE_TASK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const json = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: { taskId?: string } } | null;
  if (!res.ok || (json?.code && json.code !== 200) || !json?.data?.taskId) {
    throw new Error(friendly(json?.code ?? res.status, json?.msg || `kie.ai createTask failed (HTTP ${res.status}).`));
  }
  return json.data.taskId;
}

async function pollTask(taskId: string, key: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const gate = transientFailGate();
  while (Date.now() < deadline) {
    const res = await fetch(`${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
    if (res?.ok) {
      const json = (await res.json().catch(() => null)) as { data?: { state?: string; resultJson?: string; failMsg?: string | null } } | null;
      const d = json?.data;
      if (d?.state === "success") {
        try {
          const url = (JSON.parse(d.resultJson || "{}") as { resultUrls?: string[] }).resultUrls?.[0];
          if (url) return url;
        } catch {
          /* fall through */
        }
        throw new Error("kie.ai finished but returned no image.");
      }
      if (d?.state === "fail") {
        if (!gate.tolerate(d.failMsg)) throw new Error(d.failMsg || "Generation failed at kie.ai.");
      } else gate.reset();
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(pollTimeoutMessage("The render"));
}

type ChatContent = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type ChatReply = {
  /** kie.ai reports most failures as HTTP 200 with { code, msg } and no choices. */
  code?: number;
  msg?: string;
  choices?: { message?: { content?: string | { type?: string; text?: string; thought?: boolean }[] }; finish_reason?: string }[];
};

/** kie.ai error codes in plain words (the envelope's code, or the HTTP status). */
function chatError(code: number, msg: string): string {
  if (code === 455 || /no available channel/i.test(msg)) return "kie.ai has no free capacity for this model right now — try again in a minute.";
  if (code === 524 || /retry fail|timeout/i.test(msg)) return "kie.ai timed out talking to the model — try again.";
  return friendly(code, msg ? `kie.ai: ${msg}` : `kie.ai chat failed (code ${code}).`);
}

/** The answer text, whether content is a string or a list of parts (thought parts skipped). */
function replyText(json: ChatReply | null): string {
  const c = json?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  return "";
}

/**
 * One system + user turn on a kie.ai chat model; returns the text answer.
 * Messages use the parts form kie.ai documents (a plain string content can
 * come back empty), thoughts are not returned, and an empty or failed answer
 * is retried once before its real reason is shown.
 */
export async function kieChat(
  key: string,
  model: string,
  system: string,
  text: string,
  imageUrls: string[] = [],
  opts: { effort?: "low" | "high" } = {},
): Promise<string> {
  const content: ChatContent[] = [...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })), { type: "text", text }];
  const body = JSON.stringify({
    stream: false,
    include_thoughts: false,
    reasoning_effort: opts.effort ?? "low",
    messages: [
      { role: "system", content: [{ type: "text", text: system }] },
      { role: "user", content },
    ],
  });
  let problem = "kie.ai returned an empty answer.";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(1500);
    const res = await fetch(`https://api.kie.ai/${model}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      // A bad key or an empty balance will not fix itself; anything else gets one more try.
      problem = chatError(res.status, "");
      if (res.status === 401 || res.status === 402) break;
      continue;
    }
    const json = (await res.json().catch(() => null)) as ChatReply | null;
    if (typeof json?.code === "number" && json.code !== 200 && !json.choices) {
      problem = chatError(json.code, json.msg ?? "");
      if (json.code === 401 || json.code === 402) break;
      continue;
    }
    const out = replyText(json);
    if (out) return out;
    const finish = json?.choices?.[0]?.finish_reason;
    problem = `kie.ai returned an empty answer${finish ? ` (${finish})` : ""} — try again, or rephrase the request.`;
  }
  throw new Error(problem);
}

/** Nano Banana Pro on kie.ai: input images + instruction → hosted image URL. */
export async function kieImage(key: string, prompt: string, images: string[], aspectRatio = "4:3"): Promise<string> {
  const image_input = await Promise.all(images.map((img, i) => kieUpload(img, key, `${Date.now()}-${i}.png`)));
  const taskId = await createJob(KIE_MODELS.image(), { prompt, image_input, aspect_ratio: aspectRatio, resolution: KIE_MODELS.resolution(), output_format: "png" }, key);
  return pollTask(taskId, key);
}
