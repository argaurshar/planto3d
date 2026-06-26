// Prompt templates — the "geometry" of planto3d lives here.
//
// Both prompts ask for a true *axonometric* (parallel) projection rather than a
// perspective render, so straight walls stay straight and the result reads like
// a clean 3D map rather than a photo.

const AXONOMETRIC_RULES = [
  "Use a true axonometric / isometric projection (parallel projection, like an",
  "orthographic camera): NO perspective foreshortening, all parallel edges stay",
  "parallel, roughly 30-degree axes. Extrude the walls to a consistent height.",
  "Clean, consistent, soft lighting from one direction. Neutral architectural",
  "model look. Keep proportions, wall positions, doors and windows faithful to",
  "the source plan.",
].join(" ");

/** Whole-plan overview prompt: 2D plan -> axonometric map of the entire layout. */
export function overviewPrompt(): string {
  return [
    "This image is a 2D architectural floor plan.",
    "Generate a 3D axonometric overview map of the WHOLE plan, showing every",
    "room and its walls as a single cohesive model viewed from above at an",
    "angle.",
    AXONOMETRIC_RULES,
    "Do not add a background, text labels, dimensions, or annotations.",
  ].join(" ");
}

/**
 * Single-room prompt. `variation` (0 for the first generation, then incremented
 * by Regenerate) nudges the model to produce a genuinely different take while
 * keeping the same room.
 */
export function roomPrompt(variation: number): string {
  const base = [
    "This image is a cropped region of a 2D floor plan containing a single room.",
    "Generate a detailed 3D axonometric cutaway of THAT room: extruded walls,",
    "floor, doorways and windows where the plan shows them, plus plausible",
    "furniture appropriate to the room type.",
    AXONOMETRIC_RULES,
    "Open or cut away the near walls so the interior is visible. No background,",
    "no text, no dimensions.",
  ].join(" ");

  if (variation <= 0) return base;

  // Vary furnishing/styling on each regenerate without changing the structure.
  return [
    base,
    `Variation #${variation}: produce a clearly different interpretation from`,
    "previous attempts — alternate furniture layout, styling and materials,",
    "while keeping the same walls, doors and windows.",
  ].join(" ");
}
