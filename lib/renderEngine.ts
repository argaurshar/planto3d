// Which kie.ai model turns the clay massing into the photograph, and how.
// Transport-agnostic: the server route and the static build each supply the
// three calls, so the engine logic (prompts, passes, strengths) exists once.

import type { DesignBrief, RenderEngine } from "./types";
import {
  kontextRenderPrompt,
  referenceRenderPrompt,
  structureRenderPrompt,
  STRUCTURE_NEGATIVE_PROMPT,
} from "./prompts";

export interface EngineTransport {
  /** Multi-reference generation (Nano Banana Pro): prompt + hosted image URLs → image URL. */
  reference: (prompt: string, inputs: string[]) => Promise<string>;
  /** Classic image-to-image at a fixed denoise strength (Qwen): → image URL. */
  structure: (prompt: string, input: string, strength: number, negativePrompt: string) => Promise<string>;
  /** Structure-preserving edit (FLUX Kontext): → image URL. */
  edit: (prompt: string, input: string) => Promise<string>;
}

export interface EngineRenderArgs {
  interior: string;
  brief: DesignBrief;
  /** Hosted URL of the clay massing (outlined blocks, cast shadows). */
  clayUrl: string;
  /** Hosted URL of the depth map of the same view, if available. */
  depthUrl?: string;
  /** The verifier's findings from a previous attempt (mistakes to avoid). */
  corrections?: string[];
}

/**
 * Structure engine strengths. Image-to-image keeps the init image's
 * low-frequency structure by construction: at strength s only the last s of
 * the diffusion is re-run, so the layout survives while surfaces are
 * re-imagined. Pass 1 locks the layout from the massing; pass 2 re-runs a
 * smaller fraction from pass 1's photo for materials and detail.
 */
export const STRUCTURE_LOCK_STRENGTH = 0.62;
export const STRUCTURE_REFINE_STRENGTH = 0.38;

export async function renderWithEngine(
  engine: RenderEngine,
  t: EngineTransport,
  a: EngineRenderArgs,
): Promise<string> {
  switch (engine) {
    case "reference": {
      const inputs = a.depthUrl ? [a.clayUrl, a.depthUrl] : [a.clayUrl];
      return t.reference(referenceRenderPrompt(a.interior, a.brief, Boolean(a.depthUrl), a.corrections), inputs);
    }
    case "structure": {
      const locked = await t.structure(
        structureRenderPrompt(a.interior, a.brief, 1, a.corrections),
        a.clayUrl,
        STRUCTURE_LOCK_STRENGTH,
        STRUCTURE_NEGATIVE_PROMPT,
      );
      return t.structure(
        structureRenderPrompt(a.interior, a.brief, 2),
        locked,
        STRUCTURE_REFINE_STRENGTH,
        STRUCTURE_NEGATIVE_PROMPT,
      );
    }
    default:
      return t.edit(kontextRenderPrompt(a.interior, a.brief, a.corrections), a.clayUrl);
  }
}
