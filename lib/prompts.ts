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

import type { DesignBrief, LayoutVerification, RoomType } from "./types";
import { extractJsonObject } from "./spatial";
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
        "A second image shows a generated 3D axonometric overview of the WHOLE",
        "home; use it ONLY for style, materials and palette consistency with the",
        "rest of the home (do not describe the other rooms). The plan crop is the",
        "geometric truth — where the two disagree on layout, trust the plan crop.",
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
    "You are given a cropped region of the 2D ARCHITECTURAL FLOOR PLAN showing a",
    "single room from directly above (top-down, orthographic). Read the plan",
    "symbols: furniture is drawn as outlines (bed with pillows, sofa, table with",
    "chairs, wardrobe, toilet, sink), doors as an arc/swing in a wall gap, windows",
    "as thin lines or a break in a wall. Analyze it and reconstruct it as a",
    "PHOTOREALISTIC eye-level interior.",
    roomHint,
    overviewHint,
    layoutHint,
    "Write ONE single-paragraph, richly detailed prompt for a photorealistic",
    "architectural INTERIOR render of that room, captured from a natural EYE-LEVEL",
    "perspective looking across the space from one wall.",
    "Reconstruct the room precisely from the crop: state the room type, then",
    "describe the EXACT spatial arrangement — every major furniture piece and",
    "fixture and WHERE it sits relative to the walls (e.g. 'two beds side by side",
    "against the far wall with a single nightstand between them'), which wall the",
    "window(s) are on, and where the door is — matching the counts and positions",
    "shown. Then describe the materials, textiles, colours, decor and the",
    "lighting and mood.",
    `Use this style throughout: ${style}. Lighting: ${brief.lighting}.`,
    "Do NOT add, remove, move or invent any walls, windows, doors or furniture.",
    "Do NOT describe the camera, the entrance or a doorway — the image-to-image",
    "renderer takes any mention of a door as a cue to paint one on a visible wall.",
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
        "The provided image is a matte CLAY MASSING MODEL of this room from an",
        "eye-level viewpoint. Each block marks the exact position, size and",
        "orientation of one item; its tone says what the item IS:",
        "cream = bed, sage = seating (sofa/chair), dark wood = storage (wardrobe/",
        "cabinet/dresser/TV unit), light wood = table/desk/nightstand, pale blue =",
        "bathroom fixture (sink/bath/toilet), sand = rug, grey = other furniture;",
        "bright panel = window, wood panel = door, off-white = walls, greige =",
        "floor. Reproduce EVERY block as a real, photorealistic furniture piece of",
        "that exact type at that exact position, size and count, and keep the camera",
        "viewpoint, room proportions and wall/window/door layout. Do NOT move, add,",
        "remove or resize anything, and do not invent furniture that has no block.",
        "Take the final colours and finishes from the style below, not from the",
        "clay model. Render real materials and lighting — no flat blocks may remain.",
      ].join(" ")
    : "";
  const base = [
    blockoutLead,
    interiorPrompt.trim(),
    `Overall style: ${style}. Lighting: ${brief.lighting}.`,
    "Interior architectural photograph, natural EYE-LEVEL perspective (as if",
    "standing in the room), 24mm lens, natural daylight with soft directional",
    "shadows, physically based materials with visible wood grain and fabric",
    "weave, true-to-life colour, sharp focus — a photograph, NOT a 3D render or",
    "CGI.",
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

/** Trim to ~maxChars at a sentence boundary so prompts stay within model limits. */
function capAtSentence(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastStop = cut.lastIndexOf(". ");
  return lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut;
}

/**
 * Stage 3b render prompt for FLUX.1 Kontext — a structure-preserving EDIT model:
 * the blockout image fixes the composition, so the prompt only has to say what
 * to turn each coloured block into. Kontext prompts should stay short (~512
 * tokens), so the interior description is capped; the geometry lives in the
 * image, not the text. `corrections` (from the verify pass) are prepended on a
 * retry.
 */
export function kontextRenderPrompt(
  interiorPrompt: string,
  brief: DesignBrief,
  corrections?: string[],
): string {
  const style = resolveStyleDescriptor(brief);
  // The retry renders from the same massing again, so the verifier's findings
  // are framed as mistakes to avoid, not as edits to a previous picture.
  const fix =
    corrections && corrections.length
      ? `IMPORTANT — a previous attempt wrongly showed: ${corrections.join("; ")}. The input image is correct; do not repeat those mistakes. `
      : "";
  // Phrased as an EDIT INSTRUCTION, not a scene description: with a start image
  // that is what Kontext responds to. Materials and photographic language carry
  // most of the weight, because the geometry is already fixed by the image.
  return [
    fix,
    "Rephotograph this room as a real interior photograph.",
    "The input is a matte clay massing model with outlined blocks: keep its",
    "camera, room proportions, walls, window and door openings, and the exact",
    "position, footprint and height of every outlined block. Do not add, remove,",
    "move, resize or rotate anything, and do not add windows, doors or furniture",
    "that are not in the input. A wall with no panel or block against it in the",
    "input stays BARE: no door, window, wardrobe, dresser, shelving, radiator or",
    "artwork may appear on it.",
    "The block tones only say what each object IS (oat = bed, sage = seating,",
    "dark wood = wardrobe/storage, oak = table/desk/nightstand, pale blue =",
    "bathroom fixture, tan = rug, grey = other furniture; bright panel = window,",
    "wood panel = door). Replace every block, in place, with a real, fully",
    "detailed piece of that type — proper materials, upholstery, bedding,",
    "hardware and edge thickness. Nothing flat, blocky or untextured may remain.",
    "Use the following only for materials, colours and styling; wherever it",
    "disagrees with the input image about what is where, the image wins:",
    capAtSentence(interiorPrompt, 600),
    `Materials and style: ${style}. Lighting: ${brief.lighting}.`,
    "Interior architectural photograph, 24mm lens, natural daylight with soft",
    "directional shadows, physically based materials with visible wood grain and",
    "fabric weave, true-to-life colour, sharp focus.",
    "It must look like a photograph, NOT a 3D render, CGI or video-game image.",
  ]
    .filter(Boolean)
    .join(" ");
}

const BLOCK_LEGEND =
  "The block tones only say what each object IS (oat = bed, sage = seating, dark wood = wardrobe/storage, oak = table/desk/nightstand, pale blue = bathroom fixture, tan = rug, grey = other furniture; bright panel = window, wood panel = door).";

const BARE_WALL_RULE =
  "Nothing may be added, removed, moved, resized or rotated. A wall with no panel or block against it in the massing stays BARE: no door, window, wardrobe, dresser, shelving, radiator or artwork may appear on it.";

const PHOTO_LANGUAGE =
  "Interior architectural photograph, 24mm lens, natural daylight with soft directional shadows, physically based materials with visible wood grain and fabric weave, true-to-life colour, sharp focus. It must look like a photograph, NOT a 3D render, CGI or video-game image.";

function mistakesToAvoid(corrections?: string[]): string {
  return corrections && corrections.length
    ? `IMPORTANT — a previous attempt wrongly showed: ${corrections.join("; ")}. The massing is correct; do not repeat those mistakes. `
    : "";
}

/**
 * Reference engine (Nano Banana Pro, multi-image): image 1 is the clay
 * massing, image 2 (when present) the depth map of the same view. The model is
 * asked for the photograph that massing stands for, not for an edit of it.
 */
export function referenceRenderPrompt(
  interiorPrompt: string,
  brief: DesignBrief,
  hasDepth: boolean,
  corrections?: string[],
): string {
  const style = resolveStyleDescriptor(brief);
  return [
    mistakesToAvoid(corrections),
    "Image 1 is a clay massing model of one room photographed at eye level, with every block outlined.",
    hasDepth ? "Image 2 is the depth map of exactly the same view (white = near, black = far)." : "",
    "Produce the real photograph that this massing stands for: the SAME camera and framing, the same room proportions, walls, ceiling, window and door openings, and every outlined block replaced IN PLACE by a real, fully detailed piece of that type at the same footprint and height.",
    BLOCK_LEGEND,
    BARE_WALL_RULE,
    "Use the following only for materials, colours and styling; wherever it disagrees with image 1 about what is where, image 1 wins:",
    capAtSentence(interiorPrompt, 600),
    `Materials and style: ${style}. Lighting: ${brief.lighting}.`,
    PHOTO_LANGUAGE,
  ]
    .filter(Boolean)
    .join(" ");
}

/** What the structure engine must never re-introduce. */
export const STRUCTURE_NEGATIVE_PROMPT =
  "extra door, extra window, added furniture, different layout, moved furniture, cartoon, illustration, 3d render, cgi, clay, blocky, untextured, low detail, blurry, text, watermark, people";

/**
 * Structure engine (Qwen image-to-image). Pass 1 runs from the massing at a
 * strength that keeps the layout; it must describe the finished photo, not an
 * edit. Pass 2 runs from pass 1's photo at a lower strength for materials.
 */
export function structureRenderPrompt(
  interiorPrompt: string,
  brief: DesignBrief,
  pass: 1 | 2,
  corrections?: string[],
): string {
  const style = resolveStyleDescriptor(brief);
  if (pass === 1) {
    return [
      mistakesToAvoid(corrections),
      "Photorealistic interior photograph of exactly this room: the same camera, walls, ceiling, window and door openings, and every block is the real piece of furniture it stands for, at the same place and size.",
      BLOCK_LEGEND,
      BARE_WALL_RULE,
      `Materials and style: ${style}. Lighting: ${brief.lighting}.`,
      PHOTO_LANGUAGE,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "Refine this photograph. Keep everything exactly where it is — same camera, walls, openings and furniture — and make every surface real: bedding, upholstery, wood grain, hardware, skirting, soft daylight.",
    capAtSentence(interiorPrompt, 400),
    `Materials and style: ${style}. Lighting: ${brief.lighting}.`,
    PHOTO_LANGUAGE,
  ].join(" ");
}

/**
 * Vision-LLM system prompt that checks a finished render against the detected
 * layout. Must answer with strict JSON so the caller can act on it.
 */
export function layoutVerifierSystem(): string {
  return [
    "You are a strict architectural layout verifier. You are given an EXPECTED",
    "LAYOUT description of a room and a rendered interior photo. Check whether",
    "the photo matches the layout: the count and placement of each furniture",
    "piece, which wall the window(s) are on, and where the door is. Judge only",
    "coarse geometry (counts + which wall/zone), not style or materials.",
    "Anything the layout marks as 'behind the viewer (not visible)' is outside",
    "the frame by design: never report it as missing. Do report anything the",
    "photo shows that the layout does not list (an extra door, window or piece",
    "of furniture).",
    'Respond with ONLY this JSON, no prose: {"matches": true|false,',
    '"problems": ["what the photo wrongly shows"]} — at most 4 problems, each',
    "under 15 words, phrased as what is wrong IN THE PHOTO (e.g. 'a door on the",
    "left wall (the layout has none there)', 'bed against the right wall instead",
    "of the back wall'). If the photo matches, problems must be [].",
  ].join(" ");
}

const MAX_PROBLEMS = 4;
const MAX_PROBLEM_CHARS = 160;

/**
 * Parse the verifier's JSON reply; null on anything malformed (skip the check).
 * Problems are trimmed, de-blanked and length-capped: they are shown verbatim
 * in the UI and prefixed to the corrective render prompt, whose interior text
 * is itself capped, so an unbounded problem must not crowd it out.
 */
export function parseVerifierReply(content: string): LayoutVerification | null {
  const parsed = extractJsonObject(content);
  if (!parsed || typeof parsed.matches !== "boolean") return null;
  const problems = Array.isArray(parsed.problems)
    ? parsed.problems
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim().slice(0, MAX_PROBLEM_CHARS))
        .filter(Boolean)
        .slice(0, MAX_PROBLEMS)
    : [];
  return { matches: parsed.matches, problems };
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
    "Lay the room out exactly as the floor plan shows it: keep every furniture",
    "piece, count and position, and the window and door placement — add nothing",
    "extra and do not rearrange anything.",
    `STYLE: ${style}. Lighting: ${brief.lighting}.`,
  ].join(" ");
}
