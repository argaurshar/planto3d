import type { InlineImage } from "./types";

/**
 * Parse a `data:<mime>;base64,<data>` URL into an InlineImage.
 * Returns null if the string is not a base64 data URL.
 */
export function dataUrlToInline(dataUrl: string): InlineImage | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** Build a full data URL from an InlineImage. */
export function inlineToDataUrl(img: InlineImage): string {
  return `data:${img.mimeType};base64,${img.data}`;
}
