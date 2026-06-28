import type { InlineImage } from "./types";

/**
 * Parse a `data:<mime>;base64,<data>` URL into an InlineImage.
 * Returns null if the string is not a base64 data URL. Used by the API routes
 * to validate uploads before sending them to kie.ai.
 */
export function dataUrlToInline(dataUrl: string): InlineImage | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}
