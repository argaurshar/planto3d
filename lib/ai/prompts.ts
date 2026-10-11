// Every instruction sent to an AI model. The AI has exactly three jobs:
//   1. read the plan once (boxes + printed numbers, no guessing),
//   2. turn a command the local parser did not understand into model edits,
//   3. optionally re-light a raw shot of the exact model into a photograph.
// It never decides where anything is: the 3D model does.

import type { CeilingDesign, Item, RoomModel, Shot } from "../room/types";
import { CATALOG, ITEM_TYPES, itemLabel } from "../room/catalog";
import { STYLES, STYLE_IDS, COLOR_WORDS } from "../room/styles";
import { describeItem } from "../room/commands";
import { itemsInView } from "../room/shots";
import { moodSpec } from "../room/moods";
import { ceilingDesignOf } from "../room/geometry";

export const PLAN_READER_SYSTEM = `You are an architect reading a 2D architectural floor plan image, measuring it precisely for a true-scale 3D model.
The image shows ONE room to be modelled (if it shows several rooms, read the single largest room, or the room named in the user's hint).

Return ONLY a JSON object, no prose:
{
  "room_name": "the room's printed name, e.g. MASTER BEDROOM",
  "room_type": "bedroom | living | dining | kitchen | bathroom | study | kids | other",
  "room_box": [ymin, xmin, ymax, xmax],
  "printed_size": { "horizontal": "printed length of the room's left-to-right side, exactly as printed, e.g. 12'0\\" or 3600", "vertical": "printed length of its top-to-bottom side" },
  "openings": [ { "kind": "door | window | sliding_door | opening", "box": [ymin, xmin, ymax, xmax], "main": true | false } ],
  "items": [ { "label": "what the symbol is, e.g. king size bed, side table, wardrobe, TV unit, 3 seater sofa, armchair, coffee table, dining table, study table, chair, dresser, bookshelf, plant, rug, ceiling fan, split AC", "box": [ymin, xmin, ymax, xmax], "head": "top | bottom | left | right (beds only: the side where the pillows / headboard are)", "front": "top | bottom | left | right (the side a person uses: sofa seat, wardrobe doors, TV screen, desk front); omit if unclear" } ]
}

Rules:
- Coordinates are integers 0-1000 relative to the WHOLE image, y first: [ymin, xmin, ymax, xmax]. Boxes must be tight.
- room_box is the INSIDE faces of the room's four walls (the floor area), not the outer wall lines and not the dimension lines.
- printed_size: copy the room's own dimension text (often written inside the room under its name as "12'0\\" X 14'0\\"", or on dimension lines). "horizontal" is the width as drawn (left-right), "vertical" the depth (top-bottom). Use null if not printed. Never compute or guess a number.
- openings: every door (box = the gap in the wall plus its swing arc), window (box = the window symbol on the wall; a sliding or "slider" window is still a window), sliding_door (a full-height sliding or balcony door only), or open archway in THIS room's walls. "main": true for the ONE door people enter by from the rest of the house (not a bathroom, toilet, balcony or wardrobe door).
- items: EVERY furniture or fixture symbol drawn inside the room, one entry each (two side tables → two entries). A ceiling fan is usually a circle with blades (box = the circle); an AC is a labelled box on a wall (box = the unit, "front" = the side facing into the room). Do not invent furniture that is not drawn. Dimension lines, text, hatching, columns and walls are not items.`;

export function planReaderUser(hint?: string): string {
  return hint?.trim() ? `Hint from the user: ${hint.trim().slice(0, 200)}\nRead the plan.` : "Read the plan.";
}

/** The catalog as the AI needs it: type ids, designs, finishes. */
function catalogText(): string {
  const types = ITEM_TYPES.filter((t) => t !== "other")
    .map((t) => `${t} (${itemLabel(t)}): ${CATALOG[t].variants.map((v) => v.id).join(" | ")}`)
    .join("\n");
  return `${types}\nFinish words: ${Object.keys(COLOR_WORDS).join(", ")}; walnut, oak, white oak, teak, ash, wenge; velvet, leather, linen, boucle, cane, glass, white marble, black marble, brass, black metal, steel.\nRoom styles: ${STYLE_IDS.join(" | ")}.`;
}

export const COMMAND_SYSTEM = `You edit an exact 3D model of one room for an interior designer. Turn the user's request into model operations.
Reply ONLY with JSON: {"ops": [ ... ], "reply": "one short sentence saying what you changed, or why you could not"}

Plan coordinates are metres: x runs left→right (0…width), z runs top→bottom of the plan (0…depth). Walls: "top" (z=0), "bottom" (z=depth), "left" (x=0), "right" (x=width).
An item's "facing" is the direction its FRONT looks (bed foot, sofa seat, wardrobe doors): "up" (towards the top wall), "down", "left", "right". w = width across its front, d = depth front-to-back, h = height.

Operations:
{"op":"add","type":TYPE,"variant":DESIGN,"finish":"walnut","wall":"left","near":"ITEM_ID","count":1}   — omit x/z to let the app place it properly (preferred), or give "x","z","w","d","h","facing".
{"op":"remove","ids":["ITEM_ID"]}
{"op":"update","ids":["ITEM_ID"],"variant":DESIGN,"nextVariant":true,"finish":"emerald velvet" or null,"dx":0.3,"dz":0,"x":1.2,"z":2.0,"w":1.8,"d":2.1,"h":1.2,"facing":"down","rotate":90,"wall":"right"}
{"op":"room","wallColor":"#rrggbb","floor":"wood|tile|marble|carpet","falseCeiling":true,"ceilingDesign":"cove|island|slats|next","curtains":true,"height":3.0,"style":STYLE,"mood":"day|evening|night"}
{"op":"shot","shot":"entry|back|front|corner|top|next"}

Only use the fields you need. Use existing item ids from the room. Keep everything inside the room. Never remove or move things the user did not mention.

Types and their designs:
${catalogText()}`;

export function commandUser(room: RoomModel, text: string, selectedId: string | null): string {
  const compact = {
    name: room.name,
    kind: room.kind,
    width: room.width,
    depth: room.depth,
    height: room.height,
    style: room.style,
    floor: room.floor,
    wallColor: room.wallColor,
    falseCeiling: room.falseCeiling,
    ceilingDesign: room.falseCeiling ? room.ceilingDesign ?? "cove" : undefined,
    curtains: room.curtains,
    mood: room.mood ?? "day",
    openings: room.openings.map((o) => ({ id: o.id, kind: o.kind, wall: o.wall, offset: o.offset, width: o.width, main: o.main || undefined })),
    items: room.items.map((i) => ({ id: i.id, type: i.type, variant: i.variant, finish: i.finish, x: i.x, z: i.z, w: i.w, d: i.d, h: i.h, facing: i.facing })),
  };
  return `Room: ${JSON.stringify(compact)}\nSelected item: ${selectedId ?? "none"}\nRequest: ${text.slice(0, 500)}`;
}

const ROOM_WORDS: Record<RoomModel["kind"], string> = {
  bedroom: "bedroom",
  kids: "kids' bedroom",
  living: "living room",
  dining: "dining room",
  kitchen: "kitchen",
  bathroom: "bathroom",
  study: "study",
  other: "room",
};

/** The floor as a photographer would name it, matching the 3D model's material. */
function floorWords(room: RoomModel): string {
  const p = STYLES[room.style];
  switch (room.floor) {
    case "wood": {
      // The plank colour the 3D floor is painted with, in words an image model keeps.
      const tone: Record<string, string> = {
        oak: "light honey-coloured oak",
        "white-oak": "pale white oak",
        ash: "very light ash",
        teak: "medium golden teak",
        walnut: "dark walnut",
        wenge: "dark walnut",
      };
      return `${tone[p.woodAccent] ?? "light oak"} wood plank floor`;
    }
    case "tile":
      return "large light porcelain floor tiles";
    case "marble":
      return "polished white marble floor";
    default:
      return "wall-to-wall beige carpet";
  }
}

const WOOD_NAMES: Record<string, string> = { oak: "oak", walnut: "walnut", teak: "teak", "white-oak": "white oak", ash: "ash", wenge: "wenge" };

/** The ceiling as a photographer would see it, per false ceiling design. */
const CEILING_PHOTO: Record<CeilingDesign | "none", string> = {
  none: "a plain painted ceiling with its light fitting.",
  cove: "a gypsum false ceiling band around the room with a soft warm cove-light glow on the ceiling above it and recessed downlights in the band.",
  island: "a floating gypsum ceiling island with a soft warm LED glow washing the ceiling around its edges and recessed downlights in it.",
  slats: "a gypsum false ceiling band with cove light, and real wooden slats with thin dark shadow gaps across the central recess.",
};

/** What makes each floor read as real in a photograph. */
const FLOOR_DETAIL: Record<RoomModel["floor"], string> = {
  wood: "with real grain, plank seams and soft reflections of the window light",
  tile: "with fine grout lines and a soft satin reflection of the window light",
  marble: "with natural veining and glossy reflections of the windows and lights",
  carpet: "with a soft, even pile",
};

/** The nearest plain colour word for a hex colour ("#d8c7a5" → "beige"), to anchor the AI. */
function colourName(hex: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = "";
  let bestD = Infinity;
  for (const [word, h] of Object.entries(COLOR_WORDS)) {
    if (!/^#[0-9a-f]{6}$/i.test(h) || word === "gray") continue;
    const [r2, g2, b2] = rgb(h);
    // Weighted RGB distance: close enough to pick the word a person would use.
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
    if (d < bestD) [best, bestD] = [word, d];
  }
  return best;
}

/** What a piece is really made of, in the words a photographer would use. */
function realMaterial(it: Item, room: RoomModel): string {
  const p = STYLES[room.style];
  const wood = WOOD_NAMES[p.wood] ?? "walnut";
  const own = it.finish ? `${it.finish} ` : "";
  // The fabric colour the builders use when no finish is set.
  const cloth = it.finish ? "" : `${colourName(it.type === "armchair" ? p.accent : it.type === "ottoman" ? p.accent2 : p.fabric)} `;
  switch (it.type) {
    case "bed":
      return `upholstered headboard in ${own}woven fabric with real stitched channels; mattress dressed in cotton with a thick, soft duvet that drapes over the sides with natural creases; plump pillows, slightly squashed and creased; the throw stays where it lies, in its colour, as woven fabric with soft folds`;
    case "sofa":
    case "armchair":
    case "ottoman":
    case "bench":
      return `${own}${cloth}upholstery in exactly its colour from the image, with visible weave, softly rounded cushion edges and gentle seat creases${it.type === "sofa" ? "; its scatter cushions and throw stay exactly where they are, in their colours" : ""}`;
    case "rug":
      return "woven rug with real pile and texture";
    case "mirror":
      return "real mirror glass reflecting the room";
    case "plant":
      return "living plant with real leaves in a ceramic pot";
    case "artwork":
      return "framed art print behind glass";
    case "ceilingFan":
      return "ceiling fan with a powder-coated metal body and blades";
    case "ac":
      return "white matte plastic split AC unit";
    case "floorLamp":
      return "fabric lamp shade glowing softly, metal stand";
    default:
      break;
  }
  switch (CATALOG[it.type].role) {
    case "wood":
      return `${it.finish ? it.finish : `${wood} veneer`} with real grain and a satin sheen; edges very slightly rounded so they catch the light`;
    case "lacquer":
      return `${own}satin lacquer with soft reflections and slightly rounded edges`;
    case "stone":
      return `${own}polished stone with natural veining`;
    case "metal":
      return `${own}brushed metal`;
    case "ceramic":
      return "glazed white ceramic";
    case "fabric":
      return `${own}fabric with visible weave and soft folds`;
    default:
      return "real materials";
  }
}

/**
 * Instruction for the realistic pass. The input image is a raw real-time
 * render of the exact model, and it looks like CG: the AI must keep the
 * LAYOUT exactly (camera, room, which pieces, where, how big, which design and
 * colour) but re-render every SURFACE and all the LIGHT as a real photograph.
 * Telling it to keep the render "exactly" made it copy the plastic look too.
 * Only the pieces the camera really sees are named: naming a piece that is
 * out of frame (or behind the camera) makes image models paint it in.
 */
export function realisticPrompt(room: RoomModel, shot: Shot | null, extra = ""): string {
  const style = STYLES[room.style];
  const words = ROOM_WORDS[room.kind];
  const visible = shot ? itemsInView(room, shot) : room.items;
  const pieces = visible.map((i) => `- ${describeItem(i)}: ${realMaterial(i, room)}`).join("\n");
  const hasRug = visible.some((i) => i.type === "rug");
  return [
    `This image is a screenshot of a real-time 3D model of a ${words}, so it looks like CG: plastic surfaces, perfectly smooth fabric, razor-sharp edges, flat even light. Re-render it as a real photograph of the same ${words}, the kind a professional interior photographer takes for an architecture magazine, indistinguishable from a real photo.`,
    "",
    "KEEP EXACTLY (the layout is measured and correct): the camera position, height, lens, framing and perspective, with straight verticals; the walls, ceiling, false ceiling and downlights, doors and windows; every piece of furniture, which piece it is, where it stands, its size, design and colour. Do not add, remove, move or resize anything. Wherever the image shows plain wall, floor or ceiling, it stays plain: no new cabinets, shelves, art, mirrors, plants, lamps or rugs.",
    "COLOURS STAY: every piece, cushion, throw, rug, the walls and the floor keep exactly the hue and lightness they have in the image. Only texture, detail and light become real.",
    "",
    pieces ? `The pieces in the picture are exactly these, and nothing else. Make each one out of real materials:\n${pieces}` : "There is no furniture in the picture; keep it that way.",
    "",
    "MAKE IT REAL (nothing may look like 3D any more):",
    `- Floor: ${floorWords(room)} ${FLOOR_DETAIL[room.floor]}, the same tone as the image${hasRug ? "" : ", no rug"}.`,
    `- Walls and ceiling: matte painted plaster in the same colour as the image (${room.wallColor}), with subtle surface texture; the light on them falls off naturally and darkens softly into the corners.`,
    `- Ceiling: ${CEILING_PHOTO[room.falseCeiling ? ceilingDesignOf(room) : "none"]}`,
    ...(room.curtains ? ["- Curtains: sheer voile with soft vertical folds and real translucency, glowing with the light from outside; heavier linen drapes at the sides."] : []),
    "- Fabric everywhere has visible weave, softness and natural creases; wood has grain and a satin sheen; edges are crisp but very slightly rounded, never razor-sharp; metal is brushed; glass and the TV screen show faint real reflections; lamp shades glow softly.",
    `- Light: ${moodSpec(room).words} Physically based global illumination: light bounces off the floor and walls with gentle colour bleed, soft contact shadows under and behind every piece, ambient occlusion where surfaces meet, natural falloff from every light.`,
    "- Camera: full-frame camera with a 24 mm tilt-shift lens at f/8, true-to-life white balance, natural contrast and highlight roll-off, high dynamic range, crisp fine detail, a hint of photographic grain.",
    "",
    `Style, for the character of the materials only (the colours come from the image): ${style.describe}.`,
    ...(extra.trim() ? [`Also: ${extra.trim().slice(0, 300)}`] : []),
    "No people, no text, no watermark, no illustration or painterly look.",
  ].join("\n");
}
