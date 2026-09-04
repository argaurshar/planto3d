// Shared types used across client and server.

import type { SpatialBox, RoomSize } from "./spatial";

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

/** Outcome of the post-render layout check (vision LLM vs the detected layout). */
export interface LayoutVerification {
  /** true = the render matches the detected layout. */
  matches: boolean;
  /** The verifier's stated mismatches (short phrases); [] when it matches. */
  problems: string[];
}

/** Response shape returned by /api/overview and the room render action. */
export interface GenerateImageResponse {
  /**
   * Generated image. With the kie.ai backend this is a hosted URL
   * (e.g. https://tempfile.redpandaai.co/...), ready to drop into <img src>.
   */
  image: string;
  mimeType: string;
  /**
   * Layout verification for layout-locked room renders (after the one
   * corrective retry, if any). Absent when the check was not run.
   */
  verification?: LayoutVerification;
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
  /**
   * Real room size in metres, read from the plan's printed dimensions. Lets the
   * client build the blockout at true scale instead of a fixed assumed size.
   * Omitted when the plan prints no dimensions or they couldn't be read.
   */
  roomSize?: RoomSize | null;
}

export interface ApiError {
  error: string;
}
