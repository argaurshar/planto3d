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
  const fix =
    corrections && corrections.length
      ? `IMPORTANT — a previous attempt got these wrong, fix exactly these and change nothing else: ${corrections.join("; ")}. `
      : "";
  // Phrased as an EDIT INSTRUCTION, not a scene description: with a start image
  // that is what Kontext responds to. Materials and photographic language carry
  // most of the weight, because the geometry is already fixed by the image.
  return [
    fix,
    "Rephotograph this room as a real interior photograph.",
    "The input is a matte clay massing model: keep its camera, room proportions,",
    "walls, window and door openings, and the exact position, footprint and",
    "height of every object.",
    "The block tones only say what each object IS (cream = bed, sage = seating,",
    "dark wood = wardrobe/storage, light wood = table/desk/nightstand, pale blue",
    "= bathroom fixture, sand = rug, grey = other furniture; bright panel =",
    "window, wood panel = door). Replace every block with a real, fully detailed",
    "piece of that type — proper materials, upholstery, bedding, hardware and",
    "edge thickness. Nothing flat, blocky or untextured may remain.",
    capAtSentence(interiorPrompt, 700),
    `Materials and style: ${style}. Lighting: ${brief.lighting}.`,
    "Interior architectural photograph, 24mm lens, natural daylight with soft",
    "directional shadows, physically based materials with visible wood grain and",
    "fabric weave, true-to-life colour, sharp focus.",
    "It must look like a photograph, NOT a 3D render, CGI or video-game image.",
  ]
    .filter(Boolean)
    .join(" ");
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
    "the frame by design: never report it as missing.",
    'Respond with ONLY this JSON, no prose: {"matches": true|false,',
    '"problems": ["short description of each mismatch"]} — at most 4 problems,',
    "each under 15 words. If the photo matches, problems must be [].",
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
