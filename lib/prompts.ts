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
    "Write ONE single-paragraph, richly detailed prompt for a PHOTOREALISTIC 3D",
    "CUT-AWAY render of that room, viewed from the SAME elevated three-quarter",
    "(dollhouse) angle as the crop — NOT an eye-level photo and NOT a new camera.",
    "First, identify and lock the fixed elements you can actually see and state",
    "them explicitly: the count and position of each furniture piece and fixture,",
    "the windows (and which wall each is on), and the doors — and require the",
    "render to keep them exactly.",
    "CRITICAL — be 100% faithful to the layout shown in the crop: describe ONLY",
    "the walls, the room shape and proportions, the windows and doors (in their",
    "exact positions), and the furniture and fixtures that are actually visible,",
    "keeping their placement and counts the same. Do NOT invent, add, remove,",
    "move, resize or duplicate any walls, windows, doors, furniture or fixtures,",
    "and do NOT introduce rooms, openings or objects that are not in the crop.",
    "Only specify materials, textiles, colours, decor finish, lighting and mood",
    "(the things a render adds) — never change the architecture or layout.",
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
 * The attached image is the cropped region of the 3D overview; the prompt
 * insists the render reproduce that room's layout EXACTLY (no hallucinating or
 * rearranging walls/openings/furniture) as a photoreal 3D CUT-AWAY from the
 * overview's own elevated angle — a faithful restyle, NOT an eye-level photo.
 * This keeps the task an "edit" (Nano Banana's strength) instead of a
 * hallucination-prone top-down→eye-level re-projection.
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
        "use it ONLY for architectural style, materials and palette consistency",
        "across rooms.",
      ].join(" ")
    : "";
  const base = [
    interiorPrompt.trim(),
    `Overall style: ${style}. Lighting: ${brief.lighting}.`,
    "IMPORTANT: the first attached image is a cropped region of a 3D axonometric",
    "overview of THIS room. Re-render THAT SAME crop as a photorealistic 3D",
    "cut-away from the SAME elevated three-quarter (dollhouse) viewpoint — keep",
    "the overview's camera angle; do NOT switch to an eye-level photo and do NOT",
    "move the camera into the room. Treat this as a faithful RESTYLE of the",
    "existing 3D view: keep the wall positions, room shape and proportions, the",
    "window and door positions, and the furniture arrangement, type and count",
    "EXACTLY as shown. Do NOT add, remove, move, resize, duplicate or hallucinate",
    "any walls, windows, doors, furniture or fixtures, and do NOT invent extra",
    "space or rooms. Change ONLY surface materials, textures, colours, decor",
    "finish and lighting to make it photorealistic — never the architecture.",
    overviewClause,
    "Realistic materials and lighting, high detail.",
    "No text, no watermark, no dimensions, no floor-plan lines.",
  ]
    .filter(Boolean)
    .join(" ");
  if (variation <= 0) return base;
  return [
    base,
    `Variation #${variation}: keep the SAME layout, walls, windows, doors,`,
    "furniture placement and camera angle exactly — vary only the",
    "lighting/time-of-day, material and textile finishes, and decor accents.",
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
    `Photorealistic 3D cut-away render of a ${room} from the SAME elevated`,
    "three-quarter (dollhouse) angle as this cropped region of a 3D axonometric",
    "overview, reproduced EXACTLY. Preserve the wall positions, room shape and",
    "proportions, window and door positions, and the furniture arrangement and",
    "count shown — do NOT add, remove, move or invent anything in the layout;",
    "change only materials, finishes and lighting. Keep the camera angle (no",
    "eye-level photo).",
    `STYLE: ${style}. Lighting: ${brief.lighting}.`,
  ].join(" ");
}
