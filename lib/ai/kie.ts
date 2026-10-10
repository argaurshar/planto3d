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

/** One system + user turn on a kie.ai chat model; returns the text answer. */
export async function kieChat(key: string, model: string, system: string, text: string, imageUrls: string[] = []): Promise<string> {
  const content: ChatContent[] = [...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })), { type: "text", text }];
  const res = await fetch(`https://api.kie.ai/${model}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) throw new Error(friendly(res.status, `kie.ai chat failed (HTTP ${res.status}).`));
  const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const out = json?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!out) throw new Error("kie.ai returned an empty answer.");
  return out;
}

/** Nano Banana Pro on kie.ai: input images + instruction → hosted image URL. */
export async function kieImage(key: string, prompt: string, images: string[], aspectRatio = "4:3"): Promise<string> {
  const image_input = await Promise.all(images.map((img, i) => kieUpload(img, key, `${Date.now()}-${i}.png`)));
  const taskId = await createJob(KIE_MODELS.image(), { prompt, image_input, aspect_ratio: aspectRatio, resolution: KIE_MODELS.resolution(), output_format: "png" }, key);
  return pollTask(taskId, key);
}
