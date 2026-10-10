// Google Gemini API client (the user's own Google AI Studio key, "AIza…").
// Isomorphic: plain fetch, the key is a parameter. Used from the browser in
// the static build and from /api/ai in the server build.
//
// Model ids change often (previews are renamed, old ones retired), so instead
// of hard-coding them we list the models this key can use and pick the best
// one for each job: a "pro" vision model to read plans, a fast "flash" model
// for commands, and the best Nano Banana image model for realistic renders.

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GoogleModels {
  /** Strongest vision model (plan reading). */
  reader: string;
  /** Fast model (command fallback). */
  fast: string;
  /** Image generation/editing model ("Nano Banana"). */
  image: string;
}

const FALLBACK: GoogleModels = { reader: "gemini-2.5-pro", fast: "gemini-2.5-flash", image: "gemini-2.5-flash-image" };

const cache = new Map<string, Promise<GoogleModels>>();

/** Google AI Studio keys: the classic "AIza…" form and the newer "AQ.…" form. */
export function isGoogleKey(key: string): boolean {
  const k = key.trim();
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(k) || /^AQ\.[0-9A-Za-z_.-]{20,}$/.test(k);
}

function friendly(status: number, msg: string): string {
  if (status === 400 && /api key/i.test(msg)) return "Google rejected the API key — check it in Google AI Studio.";
  if (status === 401 || status === 403) return "Google API key not allowed for this model (check the key and that the Gemini API is enabled).";
  if (status === 429) return "Google rate limit or quota reached — wait a moment, or check billing in Google AI Studio.";
  if (status === 404) return `Model not found at Google: ${msg}`;
  return msg || `Google API error (HTTP ${status}).`;
}

async function call(key: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-goog-api-key": key.trim(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(friendly(res.status, json?.error?.message ?? ""));
  return json;
}

/** Version number in a model id ("gemini-3.1-pro-preview" → 3.1). */
function version(name: string): number {
  const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

const NOT_TEXT = /image|tts|audio|live|embedding|aqa|imagen|veo|learnlm|gemma|robotics|computer-use|native|thinking-exp|nano|lyria|transcribe|translate|customtools|omni|research|antigravity/;

function rankText(names: string[], prefer: "pro" | "flash"): string | null {
  const scored = names
    .filter((n) => n.startsWith("gemini-") && !NOT_TEXT.test(n))
    .map((n) => {
      const tier = /-pro\b/.test(n) ? "pro" : /flash-lite/.test(n) ? "lite" : /flash/.test(n) ? "flash" : "other";
      const tierScore = prefer === "pro" ? { pro: 3, flash: 2, lite: 0.5, other: 0 }[tier] : { flash: 3, lite: 2, pro: 1.5, other: 0 }[tier];
      // Dated snapshots and experiments last; previews are fine (newest models ship as previews).
      const penalty = (/exp|\d{2}-\d{2}$|-\d{3}$/.test(n) ? 0.6 : 0) + (/latest/.test(n) ? 0.2 : 0);
      return { n, s: version(n) * 10 + tierScore - penalty };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.n ?? null;
}

function rankImage(names: string[]): string | null {
  const scored = names
    .filter((n) => n.startsWith("gemini-") && /image/.test(n) && !/imagen|generation-exp/.test(n))
    .map((n) => ({ n, s: version(n) * 10 + (/pro/.test(n) ? 4 : /lite/.test(n) ? 1 : 2) - (/exp/.test(n) ? 3 : 0) - (/preview/.test(n) ? 0.1 : 0) }))
    .sort((a, b) => b.s - a.s);
  return scored[0]?.n ?? null;
}

/** The models this key can use, best per job (cached per key). */
export function googleModels(key: string): Promise<GoogleModels> {
  const k = key.trim();
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      try {
        const names: string[] = [];
        let token = "";
        for (let page = 0; page < 5; page++) {
          const json = (await call(k, `models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`)) as {
            models?: { name?: string; supportedGenerationMethods?: string[] }[];
            nextPageToken?: string;
          };
          for (const m of json.models ?? []) {
            if (m.name && (m.supportedGenerationMethods ?? ["generateContent"]).includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
          }
          if (!json.nextPageToken) break;
          token = json.nextPageToken;
        }
        return {
          reader: rankText(names, "pro") ?? FALLBACK.reader,
          fast: rankText(names, "flash") ?? FALLBACK.fast,
          image: rankImage(names) ?? FALLBACK.image,
        };
      } catch (e) {
        // A bad key must surface; a listing hiccup falls back to known ids.
        if (e instanceof Error && /key|not allowed|rejected/i.test(e.message)) {
          cache.delete(k);
          throw e;
        }
        return FALLBACK;
      }
    })();
    cache.set(k, p);
  }
  return p;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export function dataUrlPart(dataUrl: string): Part {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!m) throw new Error("Expected an image data URL.");
  return { inlineData: { mimeType: m[1], data: m[2] } };
}

interface GenerateResponse {
  candidates?: { content?: { parts?: ({ text?: string; inlineData?: { mimeType?: string; data?: string } } & Record<string, unknown>)[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

/** Text (JSON) answer from a Gemini model, given a system prompt and user parts. */
export async function geminiText(
  key: string,
  model: string,
  system: string,
  parts: Part[],
  opts: { json?: boolean; temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const json = (await call(
    key,
    `models/${encodeURIComponent(model)}:generateContent`,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    },
    opts.signal,
  )) as GenerateResponse;
  if (json.promptFeedback?.blockReason) throw new Error(`Google blocked the request (${json.promptFeedback.blockReason}).`);
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p.text === "string" && !p.thought ? p.text : ""))
    .join("")
    .trim();
  if (!text) throw new Error(`The model returned no answer (${json.candidates?.[0]?.finishReason ?? "empty"}).`);
  return text;
}

/**
 * Edit an image with a Nano Banana model: the input image plus an instruction
 * in, a new image out (as a data URL).
 */
export async function geminiImage(
  key: string,
  model: string,
  prompt: string,
  images: string[],
  opts: { aspectRatio?: string; size?: "1K" | "2K" | "4K"; signal?: AbortSignal } = {},
): Promise<string> {
  // Only the newer image models take an output size.
  const sized = /gemini-(3|[4-9])/.test(model);
  const json = (await call(
    key,
    `models/${encodeURIComponent(model)}:generateContent`,
    {
      contents: [{ role: "user", parts: [...images.map(dataUrlPart), { text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: opts.aspectRatio ?? "4:3", ...(sized ? { imageSize: opts.size ?? "2K" } : {}) },
      },
    },
    opts.signal,
  )) as GenerateResponse;
  if (json.promptFeedback?.blockReason) throw new Error(`Google blocked the request (${json.promptFeedback.blockReason}).`);
  for (const p of json.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) return `data:${p.inlineData.mimeType ?? "image/png"};base64,${p.inlineData.data}`;
  }
  const said = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(" ").trim();
  throw new Error(said ? `No image came back: ${said.slice(0, 200)}` : `No image came back (${json.candidates?.[0]?.finishReason ?? "empty"}).`);
}
