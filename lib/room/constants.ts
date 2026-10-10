// Shared dimensions of the room shell, in metres. Pure numbers so plan code
// (placement, commands, AI parsing) can use them without three.js.

/** Wall thickness drawn around the room's interior. */
export const WALL_T = 0.15;
/** Skirting height. */
export const SKIRT_H = 0.1;
/** How far a false ceiling hangs below the true ceiling. */
export const FALSE_CEILING_DROP = 0.3;
/** Gap left between a piece's back and the wall it stands against. */
export const WALL_CLEAR = 0.02;
