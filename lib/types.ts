// Shared types used across client and server.

import type { SpatialBox } from "./spatial";

/** A base64-encoded image plus its mime type (no data: URL prefix). */
export interface InlineImage {
  /** Raw base64 (no `data:<mime>;base64,` prefix). */
  data: string;
  mimeType: string;
}

/** Room categories used to guide the prompt-writer and renderer. */
export type RoomType =
  | "auto"
  | "bedroom"
  | "living"
  | "kitchen"
  | "bathroom"
  | "dining"
  | "office"
  | "hallway";

export const ROOM_TYPES: { value: RoomType; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "bedroom", label: "Bedroom" },
  { value: "living", label: "Living room" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "dining", label: "Dining" },
  { value: "office", label: "Office" },
  { value: "hallway", label: "Hallway" },
];

/**
 * The "design brief" — global parameters captured once and threaded into every
 * prompt (overview + per-room).
 */
export interface DesignBrief {
  /** Style preset id (see lib/styles.ts), or "custom". */
  styleId: string;
  /** Free-text style override; used when styleId === "custom" or to augment. */
  customStyle?: string;
  /** Lighting description, e.g. "natural afternoon light from the east". */
  lighting: string;
  /** Optional plan metadata that sharpens the overview prompt. */
  areaSqm?: number;
  beds?: number;
  baths?: number;
  dwelling?: string;
}

/** Response shape returned by /api/overview and the room render action. */
export interface GenerateImageResponse {
  /**
   * Generated image. With the kie.ai backend this is a hosted URL
   * (e.g. https://tempfile.redpandaai.co/...), ready to drop into <img src>.
   */
  image: string;
  mimeType: string;
}

/** Response shape returned by the room "write" action (Stage 3a). */
export interface RoomPromptResponse {
  /** The auto-written, editable photorealistic interior prompt. */
  prompt: string;
  /**
   * Detected spatial boxes for the room crop (Gemini 0-1000 coords). Surfaced to
   * the client so it can build the eye-level 3D blockout for the render. Empty/
   * omitted when detection failed.
   */
  boxes?: SpatialBox[];
}

export interface ApiError {
  error: string;
}
