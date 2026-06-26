import "server-only";

import { GoogleGenAI } from "@google/genai";
import type { InlineImage } from "./types";

/**
 * Server-only wrapper around the Google GenAI SDK for Nano Banana Pro
 * (Gemini 3 Pro Image). The API key is read from the environment and never
 * leaves the server.
 */

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError(
      "GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add your key.",
      500,
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/** Error carrying an HTTP status so routes can map it to a clean response. */
export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

/**
 * Generate a single image from a text prompt plus zero or more input images.
 * Returns the first inline image found in the model response.
 */
export async function generateImage(
  prompt: string,
  inputImages: InlineImage[] = [],
): Promise<InlineImage> {
  const ai = getClient();

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [{ text: prompt }];
  for (const img of inputImages) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: { responseModalities: ["IMAGE"] },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface auth/quota problems with a 502 by default; the SDK message is
    // usually descriptive enough for the UI.
    throw new GeminiError(`Gemini request failed: ${message}`);
  }

  const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of candidateParts) {
    const inline = part.inlineData;
    if (inline?.data) {
      return {
        data: inline.data,
        mimeType: inline.mimeType || "image/png",
      };
    }
  }

  // No image came back — bubble up any text the model returned to aid debugging.
  const text = candidateParts
    .map((p) => p.text)
    .filter(Boolean)
    .join(" ")
    .trim();
  throw new GeminiError(
    text
      ? `Model returned no image. It said: "${text}"`
      : "Model returned no image.",
  );
}
