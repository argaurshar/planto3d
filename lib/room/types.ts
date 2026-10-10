// The room as ONE exact, true-scale model. Everything the user sees — the live
// 3D view, every raw shot, the Blender export and the input to the optional AI
// "make realistic" pass — is built from this object, so they can never
// disagree. AI only ever proposes a RoomModel (plan reading) or edits to it
// (commands); it never draws the room.
//
// Coordinates are plan coordinates in METRES, as the plan is drawn:
//   x → to the right, z → downward (towards the bottom of the plan).
// The room's interior floor runs from (0, 0) at its top-left corner to
// (width, depth). In 3D, y is up and x/z map 1:1, so the plan's top wall is the
// far wall when you look "up" the plan.

/** A room wall, named by the side of the plan it is drawn on. */
export type Wall = "top" | "bottom" | "left" | "right";

/** A direction in plan terms. "up" is towards the top of the plan (−z). */
export type Dir = "up" | "down" | "left" | "right";

export type RoomKind =
  | "bedroom"
  | "living"
  | "dining"
  | "kitchen"
  | "bathroom"
  | "study"
  | "kids"
  | "other";

export type FloorFinish = "wood" | "tile" | "marble" | "carpet";

/** Time of day the room is lit for: daylight, golden-hour evening, or night with only its own lights. */
export type Mood = "day" | "evening" | "night";

export type StyleId = "modern-warm" | "scandinavian" | "luxury" | "minimal" | "indian-contemporary";

export type ItemType =
  | "bed"
  | "bedBack"
  | "nightstand"
  | "wardrobe"
  | "dresser"
  | "tvUnit"
  | "sofa"
  | "armchair"
  | "coffeeTable"
  | "sideTable"
  | "ottoman"
  | "diningSet"
  | "desk"
  | "chair"
  | "bookshelf"
  | "sideboard"
  | "rug"
  | "plant"
  | "floorLamp"
  | "artwork"
  | "mirror"
  | "kitchenCounter"
  | "fridge"
  | "toilet"
  | "vanity"
  | "shower"
  | "bathtub"
  | "bench"
  | "ceilingFan"
  | "ac"
  | "other";

/**
 * One piece of furniture or fixture. (x, z) is the centre of its footprint in
 * plan metres. `w` is its width as you stand in front of it, `d` its depth
 * front-to-back, `h` its height. `facing` is the way its FRONT looks — a bed's
 * foot, a sofa's seat, a wardrobe's doors — so its back is on the opposite side.
 */
export interface Item {
  id: string;
  type: ItemType;
  /** Design variant id from the catalog (e.g. "upholstered", "wingback"). */
  variant: string;
  /** Optional finish override for the main material (e.g. "walnut", "white", "grey"). */
  finish?: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  facing: Dir;
  /** Free label shown to the user (e.g. "study chair"); defaults to the catalog label. */
  label?: string;
  /** Height above the floor of the item's bottom (wall-hung units, artwork, a split AC). */
  elevation?: number;
}

export type OpeningKind = "door" | "window" | "sliding" | "opening";

/**
 * A door or window in one of the four walls. `offset` is the distance in
 * metres along the wall from its start (the left end of the top/bottom walls,
 * the top end of the left/right walls) to the CENTRE of the opening.
 */
export interface Opening {
  id: string;
  kind: OpeningKind;
  wall: Wall;
  offset: number;
  width: number;
  /** Clear height of the opening. Doors default to 2.1 m, windows to 1.35 m. */
  height: number;
  /** Height of a window's sill above the floor (0 for doors). */
  sill: number;
  /** The door you enter the room by — where the entry shot is taken from. */
  main?: boolean;
}

export interface RoomModel {
  version: 1;
  name: string;
  kind: RoomKind;
  /** Interior size in metres: left-right (x) and top-bottom (z) as drawn on the plan. */
  width: number;
  depth: number;
  /** Floor to (true) ceiling height in metres. */
  height: number;
  /** A perimeter false ceiling with cove light and downlights. */
  falseCeiling: boolean;
  /** Curtains on every window. */
  curtains: boolean;
  floor: FloorFinish;
  /** Wall paint colour, hex like "#e9e4dc". */
  wallColor: string;
  style: StyleId;
  openings: Opening[];
  items: Item[];
  /** Where the room's numbers came from, for the UI's honesty line. */
  scaleSource?: "printed" | "estimated" | "manual";
  /** Where the room sits on the uploaded plan, for the plan check view. */
  plan?: PlanFit;
  /** Lighting mood; absent means day. */
  mood?: Mood;
}

/**
 * The room's interior rectangle on the plan image it was read from. The image
 * itself is kept outside the model (it is large); `ref` ties the two together.
 * The box maps the whole room, so the overlay stays aligned after a resize.
 */
export interface PlanFit {
  ref: string;
  /** Pixel size of the plan image the box is measured on. */
  imageW: number;
  imageH: number;
  /** Inner faces of the walls in image pixels: [left, top, right, bottom]. */
  box: [number, number, number, number];
}

/** A camera position the room is shot from. */
export interface Shot {
  id: string;
  label: string;
  /** Eye position and look-at target in 3D (x, y, z) metres. */
  pos: [number, number, number];
  target: [number, number, number];
  /** Vertical field of view in degrees (for a 4:3 frame). */
  fov: number;
  /** Vertical lens shift in fractions of the half frame (negative = show more floor). */
  shiftY: number;
  /** Scene object names hidden for this shot (e.g. the wall the camera stands behind). */
  hide: string[];
  /** A one-line explanation for the UI. */
  note: string;
}
