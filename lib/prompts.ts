// Prompt templates — the "geometry" and the interior-design intent of planto3d
// live here.
//
// Two render styles:
//  - the OVERVIEW is a true axonometric (parallel) top-view of the whole plan;
//  - each ROOM is a photorealistic, eye-level interior render.
//
// Stage 3 is two-step: a vision LLM first writes a detailed interior prompt
// (Stage 3a, `promptWriterSystem`), then the image model renders it
// (Stage 3b, `roomRenderPrompt`).

import type { DesignBrief, RoomType } from "./types";
import { resolveStyleDescriptor } from "./styles";

const AXONOMETRIC_RULES = [
  "Use a true axonometric / isometric projection (parallel projection, like an",
  "orthographic camera): NO perspective foreshortening, all parallel edges stay",
  "parallel, roughly 30-degree axes. Extrude the walls to a consistent height.",
  "Clean, consistent, soft lighting. Keep proportions, wall positions, doors and",
  "windows faithful to the source plan.",
].join(" ");

function metaPhrase(brief: DesignBrief): string {
  const parts: string[] = [];
  if (brief.dwelling) parts.push(brief.dwelling);
  if (brief.beds) parts.push(`${brief.beds}-bed`);
  if (brief.baths) parts.push(`${brief.baths}-bath`);
  if (brief.areaSqm) parts.push(`${brief.areaSqm}sqm`);
  return parts.length ? ` of a ${parts.join(" ")} home` : "";
}

/** Stage 1: whole-plan 2D plan -> axonometric overview map of the layout. */
export function overviewPrompt(brief: DesignBrief): string {
  const style = resolveStyleDescriptor(brief);
  return [
    "This image is a 2D architectural floor plan.",
    `Using it as a guide for depth and spatial layout, generate a full overhead`,
    `3D axonometric (isometric) overview render${metaPhrase(brief)}, showing every`,
    "room and its walls as a single cohesive model viewed from above at an angle.",
    AXONOMETRIC_RULES,
    `Lighting: ${brief.lighting}.`,
    `STYLE: ${style}.`,
    "Do not add a background, text labels, dimensions, or annotations.",
  ].join(" ");
}

/**
 * Stage 3a system instruction for the vision LLM. It receives the cropped room
 * image and returns ONE detailed photorealistic interior prompt.
 */
export function promptWriterSystem(
  brief: DesignBrief,
  roomType: RoomType,
  hasOverview = false,
): string {
  const style = resolveStyleDescriptor(brief);
  const roomHint =
    roomType && roomType !== "auto"
      ? `The room is a ${roomType}.`
      : "First infer the room type from the layout.";
  const overviewHint = hasOverview
    ? [
        "A second image shows a 3D axonometric overview of the WHOLE home; use it",
        "to keep the room's architecture, materials and palette consistent with",
        "the rest of the home (do not describe the other rooms).",
      ].join(" ")
    : "";
  return [
    "You are an expert architectural-visualization prompt writer specializing in",
    "high-end interior renders.",
    "You will be given a cropped region of a 3D axonometric overview render",
    "showing a single room from above at an angle.",
    roomHint,
    overviewHint,
    "Write ONE single-paragraph, richly detailed prompt for a PHOTOREALISTIC",
    "interior render of that room, captured from a natural EYE-LEVEL perspective",
    "as if standing in an open doorway looking into the space.",
    "Describe: the room type, camera viewpoint, wall/floor/ceiling materials,",
    "the main furniture and fixtures and their placement (faithful to the room's",
    "layout, doors and windows shown in the crop), textiles, decor, and the",
    "lighting and mood.",
    `Respect this style throughout: ${style}.`,
    `Lighting: ${brief.lighting}.`,
    "Output ONLY the prompt text — no preamble, no headings, no quotes, no lists.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Stage 3b: wrap the (LLM-written or user-edited) interior prompt with render
 * constraints. The `brief` is re-injected here so style/lighting anchor every
 * render even if the user edited it out of the prompt text. `variation`
 * (incremented by Regenerate) nudges a different take.
 *
 * The attached image is the 2D plan crop — explicitly framed as a top-down
 * LAYOUT reference only, so the model produces an eye-level photo rather than
 * copying the plan's lines or viewpoint.
 */
export function roomRenderPrompt(
  interiorPrompt: string,
  variation: number,
  brief: DesignBrief,
  hasOverviewRef = false,
): string {
  const style = resolveStyleDescriptor(brief);
  const overviewClause = hasOverviewRef
    ? [
        "A SECOND reference image is a 3D axonometric overview of the whole home;",
        "use it ONLY for architectural style, materials and palette consistency.",
        "Do NOT adopt its top-down / parallel-projection camera — the output must",
        "stay an eye-level photograph.",
      ].join(" ")
    : "";
  const base = [
    interiorPrompt.trim(),
    `Overall style: ${style}. Lighting: ${brief.lighting}.`,
    "IMPORTANT: the first attached image is a cropped region of a 3D axonometric",
    "overview of THIS room — use it as the reference for the room's shape, walls,",
    "windows, doors and overall furnishing. Recreate that same room as a",
    "photorealistic, ground-level EYE-LEVEL photograph; do NOT keep its angled,",
    "top-down/parallel-projection overview camera.",
    overviewClause,
    "Realistic materials and lighting, high detail.",
    "No text, no watermark, no dimensions, no floor-plan lines.",
  ]
    .filter(Boolean)
    .join(" ");
  if (variation <= 0) return base;
  return [
    base,
    `Variation #${variation}: offer a clearly different take — alternate camera`,
    "angle, furniture arrangement and styling — while keeping the same room",
    "type, walls, doors and windows.",
  ].join(" ");
}

/**
 * Fallback Stage 3a prompt used when the LLM prompt-writer is unavailable, so
 * the user can still render. Templated from the brief + room type.
 */
export function fallbackRoomPrompt(
  brief: DesignBrief,
  roomType: RoomType,
): string {
  const style = resolveStyleDescriptor(brief);
  const room = roomType && roomType !== "auto" ? roomType : "room";
  return [
    `Photorealistic eye-level interior render of a ${room}, based on this cropped`,
    "region of a 3D axonometric overview. Faithful to the room's layout, doors",
    "and windows, with plausible furniture and fixtures for the room type.",
    `STYLE: ${style}. Lighting: ${brief.lighting}.`,
  ].join(" ");
}
