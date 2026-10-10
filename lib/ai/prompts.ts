// Every instruction sent to an AI model. The AI has exactly three jobs:
//   1. read the plan once (boxes + printed numbers, no guessing),
//   2. turn a command the local parser did not understand into model edits,
//   3. optionally re-light a raw shot of the exact model into a photograph.
// It never decides where anything is: the 3D model does.

import type { RoomModel, Shot } from "../room/types";
import { CATALOG, ITEM_TYPES, itemLabel } from "../room/catalog";
import { STYLES, STYLE_IDS, COLOR_WORDS } from "../room/styles";
import { describeItem } from "../room/commands";
import { itemsInView } from "../room/shots";

export const PLAN_READER_SYSTEM = `You are an architect reading a 2D architectural floor plan image, measuring it precisely for a true-scale 3D model.
The image shows ONE room to be modelled (if it shows several rooms, read the single largest room, or the room named in the user's hint).

Return ONLY a JSON object, no prose:
{
  "room_name": "the room's printed name, e.g. MASTER BEDROOM",
  "room_type": "bedroom | living | dining | kitchen | bathroom | study | kids | other",
  "room_box": [ymin, xmin, ymax, xmax],
  "printed_size": { "horizontal": "printed length of the room's left-to-right side, exactly as printed, e.g. 12'0\\" or 3600", "vertical": "printed length of its top-to-bottom side" },
  "openings": [ { "kind": "door | window | sliding | opening", "box": [ymin, xmin, ymax, xmax], "main": true | false } ],
  "items": [ { "label": "what the symbol is, e.g. king size bed, side table, wardrobe, TV unit, 3 seater sofa, armchair, coffee table, dining table, study table, chair, dresser, bookshelf, plant, rug", "box": [ymin, xmin, ymax, xmax], "head": "top | bottom | left | right (beds only: the side where the pillows / headboard are)", "front": "top | bottom | left | right (the side a person uses: sofa seat, wardrobe doors, TV screen, desk front); omit if unclear" } ]
}

Rules:
- Coordinates are integers 0-1000 relative to the WHOLE image, y first: [ymin, xmin, ymax, xmax]. Boxes must be tight.
- room_box is the INSIDE faces of the room's four walls (the floor area), not the outer wall lines and not the dimension lines.
- printed_size: copy the room's own dimension text (often written inside the room under its name as "12'0\\" X 14'0\\"", or on dimension lines). "horizontal" is the width as drawn (left-right), "vertical" the depth (top-bottom). Use null if not printed. Never compute or guess a number.
- openings: every door (box = the gap in the wall plus its swing arc), window (box = the window symbol on the wall), sliding / balcony door, or open archway in THIS room's walls. "main": true for the ONE door people enter by from the rest of the house (not a bathroom, toilet, balcony or wardrobe door).
- items: EVERY furniture or fixture symbol drawn inside the room, one entry each (two side tables → two entries). Do not invent furniture that is not drawn. Dimension lines, text, hatching, columns and walls are not items.`;

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
{"op":"room","wallColor":"#rrggbb","floor":"wood|tile|marble|carpet","falseCeiling":true,"curtains":true,"height":3.0,"style":STYLE}
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
    curtains: room.curtains,
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

/**
 * Instruction for the realistic pass. The input image is a raw render of the
 * exact model; the model may change how things LOOK, never what or where they
 * are. Only the pieces the camera really sees are named: naming a piece that
 * is out of frame (or behind the camera) makes image models paint it in.
 */
export function realisticPrompt(room: RoomModel, shot: Shot | null, extra = ""): string {
  const style = STYLES[room.style];
  const visible = shot ? itemsInView(room, shot) : room.items;
  const pieces = visible.map((i) => `${describeItem(i)}${i.finish ? `, ${i.finish}` : ""}`).join("; ");
  const hasRug = visible.some((i) => i.type === "rug");
  return [
    `Turn this 3D render into a real photograph of the same ${ROOM_WORDS[room.kind]}, taken by a professional interior photographer.`,
    "It is a render of an exact, true-scale 3D model, so everything in it is already correct. Keep EXACTLY: the camera position, height, lens and framing; the walls, ceiling, floor and every door and window; every piece of furniture and decor — its position, size, shape, design, colour and pattern. Do not add, remove, move, resize or restyle anything.",
    pieces ? `The furniture in the picture is exactly this, and nothing else: ${pieces}.` : "There is no furniture in the picture; keep it that way.",
    "Wherever the render shows plain wall, plain floor or plain ceiling, it stays plain: no cabinets, wardrobes, shelves, doors, windows, art, mirrors, plants, lamps or rugs are added anywhere.",
    `Floor: a ${floorWords(room)}, exactly as light or dark as in the render, same plank direction${hasRug ? "" : ", no rug"}; do not darken or recolour it. Walls: the same paint colour as the render (${room.wallColor}).`,
    "Change only how it looks: real materials with true texture (wood grain, fabric weave, stone veining, paint), soft natural daylight from the windows with physically correct soft shadows, bounce light and ambient occlusion, gentle warm glow from the lights that are on, accurate reflections, subtle real-life detail (fabric creases, slight imperfections). Sharp focus, natural colour, straight verticals, high dynamic range.",
    `Style: ${style.describe}.`,
    extra.trim() ? `Also: ${extra.trim().slice(0, 300)}` : "",
    "No people, no text, no watermark.",
  ]
    .filter(Boolean)
    .join("\n");
}
