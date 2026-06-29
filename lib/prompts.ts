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
  hasLayout = false,
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
  const layoutHint = hasLayout
    ? [
        "You are also given a DETECTED SPATIAL LAYOUT produced by automated object",
        "detection on this room. Treat it as ground truth for which items exist,",
        "their counts, and their positions: reproduce exactly those items and",
        "placements at eye level, and do not add, remove, or relocate anything.",
        "Where the crop and the detected layout disagree, prefer the detected layout.",
      ].join(" ")
    : "";
  return [
    "You are an expert architectural-visualization prompt writer specializing in",
    "high-end interior renders.",
    "You are given a cropped region of a 3D overview showing a single room from",
    "above. Analyze it and reconstruct it as a PHOTOREALISTIC eye-level interior.",
    roomHint,
    overviewHint,
    layoutHint,
    "Write ONE single-paragraph, richly detailed prompt for a photorealistic",
    "architectural INTERIOR render of that room, captured from a natural EYE-LEVEL",
    "perspective, as if standing near the room's doorway/entry looking into the",
    "space.",
    "Reconstruct the room precisely from the crop: state the room type, then",
    "describe the EXACT spatial arrangement — every major furniture piece and",
    "fixture and WHERE it sits relative to the walls (e.g. 'two beds side by side",
    "against the far wall with a single nightstand between them'), which wall the",
    "window(s) are on, and where the door is — matching the counts and positions",
    "shown. Then describe the materials, textiles, colours, decor and the",
    "lighting and mood.",
    `Use this style throughout: ${style}. Lighting: ${brief.lighting}.`,
    "Do NOT add, remove, move or invent any walls, windows, doors or furniture.",
    "End the paragraph with: \"The composition preserves the exact proportions",
    "and spatial arrangement of the room without adding any extra elements.\"",
    "Output ONLY the prompt text — no preamble, no headings, no quotes, no lists.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Stage 3b: wrap the (LLM-written or user-edited) interior prompt with render
 * constraints. The `brief` is re-injected so style/lighting anchor every render.
 * `variation` (incremented by Regenerate) nudges a different take.
 *
 * Two modes:
 *  - WITHOUT a blockout (`hasBlockout` false): pure TEXT-TO-IMAGE, driven by the
 *    detailed eye-level prompt. Feeding the top-down crop here dragged earlier
 *    outputs back to a top view, so no image is sent.
 *  - WITH a blockout: IMAGE-TO-IMAGE. The caller sends a coarse eye-level 3D
 *    massing of the room as the input image; this wrapper tells the model to
 *    treat it as the exact structural/viewpoint reference and only add realism,
 *    which LOCKS the layout instead of merely describing it.
 */
export function roomRenderPrompt(
  interiorPrompt: string,
  variation: number,
  brief: DesignBrief,
  hasBlockout = false,
): string {
  const style = resolveStyleDescriptor(brief);
  const blockoutLead = hasBlockout
    ? [
        "The provided image is a rough 3D BLOCKOUT of this room from an eye-level",
        "viewpoint: grey massing blocks for furniture, plain walls and floor, and",
        "coloured panels marking window (light blue) and door (brown) openings.",
        "Use it as the EXACT structural reference — keep its camera viewpoint, room",
        "proportions, wall layout, window/door positions, and the placement and",
        "footprint of every block. Replace each grey block with real furniture of",
        "the matching type and each panel with a real window or door, but do NOT",
        "move, add, remove or resize anything.",
      ].join(" ")
    : "";
  const base = [
    blockoutLead,
    interiorPrompt.trim(),
    `Overall style: ${style}. Lighting: ${brief.lighting}.`,
    "Photorealistic architectural interior render, natural EYE-LEVEL perspective",
    "(as if standing in the room), realistic materials and lighting, high detail.",
    "Preserve the exact proportions and spatial arrangement described above; do",
    "not add, remove or rearrange any walls, windows, doors or furniture.",
    "No text, no watermark, no dimensions, no floor-plan lines, NOT a top-down view.",
  ]
    .filter(Boolean)
    .join(" ");
  if (variation <= 0) return base;
  return [
    base,
    `Variation #${variation}: keep the SAME room layout and furniture placement;`,
    "vary only the lighting/time-of-day, material and textile finishes, decor",
    "accents and the exact eye-level camera position within the room.",
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
    `Photorealistic architectural interior render of a ${room}, natural eye-level`,
    "perspective as if standing near the doorway looking into the space.",
    "Reconstruct the room from the overview crop, preserving the exact spatial",
    "arrangement, furniture positions and counts, and window and door positions",
    "— add nothing extra and do not rearrange anything.",
    `STYLE: ${style}. Lighting: ${brief.lighting}.`,
  ].join(" ");
}
