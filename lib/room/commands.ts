// Plain-English edits to the room model: "add bed back", "change the side
// table design", "make the sofa emerald velvet", "move the bed 30 cm left",
// "delete that", "paint the walls sage", "show the sofa back view"…
//
// Every command compiles to a list of small operations (Op) that are applied
// to the exact model. The AI fallback (for phrasing the local parser does not
// understand) returns the SAME operations as JSON, so nothing — local or AI —
// ever edits the room except through `applyOps`, which validates and places.

import type { Dir, FloorFinish, Item, ItemType, RoomKind, RoomModel, StyleId, Wall } from "./types";
import { CATALOG, ITEM_TYPES, itemLabel, normalize, typeFromWords, ROOM_KINDS } from "./catalog";
import { COLOR_WORDS, STYLES, STYLE_IDS } from "./styles";
import { clamp, dirVec, footprint, mainItem, opposite, round2, wallOfDir } from "./geometry";
import { againstWallAt, clampInside, dirFromVec, fitOnWall, newId, placeNew, settle, wallLen } from "./place";
import { WALL_CLEAR } from "./constants";

// ---------------------------------------------------------------- operations

export type Op =
  | {
      op: "add";
      type: ItemType;
      variant?: string;
      finish?: string;
      wall?: Wall;
      /** Id of the piece it belongs with (the bed for side tables). */
      near?: string;
      count?: number;
      x?: number;
      z?: number;
      w?: number;
      d?: number;
      h?: number;
      facing?: Dir;
      elevation?: number;
      label?: string;
    }
  | { op: "remove"; ids: string[] }
  | {
      op: "update";
      ids: string[];
      variant?: string;
      /** Next design in the catalog. */
      nextVariant?: boolean;
      finish?: string | null;
      x?: number;
      z?: number;
      dx?: number;
      dz?: number;
      w?: number;
      d?: number;
      h?: number;
      scale?: number;
      facing?: Dir;
      rotate?: 90 | -90 | 180;
      wall?: Wall;
      elevation?: number;
      label?: string;
    }
  | {
      op: "room";
      wallColor?: string;
      floor?: FloorFinish;
      falseCeiling?: boolean;
      curtains?: boolean;
      height?: number;
      style?: StyleId;
      width?: number;
      depth?: number;
      name?: string;
      kind?: RoomKind;
    }
  | { op: "shot"; shot: string };

export interface ApplyResult {
  room: RoomModel;
  /** What happened, one sentence per change. */
  messages: string[];
  /** What could not be done, and why. */
  errors: string[];
  /** Item to select afterwards (the one just added or edited). */
  select: string | null;
  /** Shot to switch to, by shot id or a keyword the UI resolves ("next", "corner"). */
  shot: string | null;
  changed: boolean;
}

const WALLS: Wall[] = ["top", "bottom", "left", "right"];
const DIRS: Dir[] = ["up", "down", "left", "right"];

function variantOf(type: ItemType, variant: string | undefined): string {
  const vs = CATALOG[type].variants;
  return vs.find((v) => v.id === variant)?.id ?? vs[0].id;
}

export function variantLabel(it: Pick<Item, "type" | "variant">): string {
  return CATALOG[it.type].variants.find((v) => v.id === it.variant)?.label ?? it.variant;
}

/** "side table (Two drawers)" */
export function describeItem(it: Item): string {
  return `${it.label ?? itemLabel(it.type)} (${variantLabel(it).toLowerCase()})`;
}

function plural(n: number, word: string): string {
  return n === 1 ? `the ${word}` : `${n} ${word.endsWith("s") ? word : `${word}s`}`;
}

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : undefined;

/** Apply operations to a room. Never throws; bad ops are reported in `errors`. */
export function applyOps(room0: RoomModel, ops: Op[]): ApplyResult {
  let room: RoomModel = { ...room0, items: room0.items.map((i) => ({ ...i })), openings: room0.openings.map((o) => ({ ...o })) };
  const messages: string[] = [];
  const errors: string[] = [];
  let select: string | null = null;
  let shot: string | null = null;
  let changed = false;

  for (const op of ops) {
    try {
      if (op.op === "shot") {
        shot = op.shot;
        continue;
      }
      if (op.op === "room") {
        const r = { ...room };
        const notes: string[] = [];
        if (op.wallColor && /^#[0-9a-f]{6}$/i.test(op.wallColor)) {
          r.wallColor = op.wallColor.toLowerCase();
          notes.push("walls repainted");
        }
        if (op.floor && ["wood", "tile", "marble", "carpet"].includes(op.floor)) {
          r.floor = op.floor;
          notes.push(`${op.floor} floor`);
        }
        if (typeof op.falseCeiling === "boolean") {
          r.falseCeiling = op.falseCeiling;
          notes.push(op.falseCeiling ? "false ceiling with cove light added" : "false ceiling removed");
        }
        if (typeof op.curtains === "boolean") {
          r.curtains = op.curtains;
          notes.push(op.curtains ? "curtains added" : "curtains removed");
        }
        const h = num(op.height, 2.4, 6);
        if (h) {
          r.height = round2(h);
          notes.push(`ceiling height ${r.height.toFixed(2)} m`);
        }
        if (op.style && STYLE_IDS.includes(op.style)) {
          r.style = op.style;
          notes.push(`${STYLES[op.style].label} style`);
        }
        const w = num(op.width, 1.2, 20);
        const d = num(op.depth, 1.2, 20);
        if (w || d) {
          r.width = round2(w ?? r.width);
          r.depth = round2(d ?? r.depth);
          r.items = r.items.map((it) => clampInside(r, it));
          r.openings = r.openings.map((o) => ({ ...o, offset: clamp(o.offset, o.width / 2, wallLen(r, o.wall) - o.width / 2) }));
          notes.push(`room resized to ${r.width.toFixed(2)} × ${r.depth.toFixed(2)} m`);
        }
        if (op.name) r.name = String(op.name).slice(0, 60);
        if (op.kind && ROOM_KINDS.some((k) => k.value === op.kind)) r.kind = op.kind;
        if (notes.length) {
          room = r;
          changed = true;
          messages.push(cap(notes.join(", ")) + ".");
        }
        continue;
      }
      if (op.op === "remove") {
        const ids = new Set(op.ids);
        const gone = room.items.filter((i) => ids.has(i.id));
        if (!gone.length) continue;
        room = { ...room, items: room.items.filter((i) => !ids.has(i.id)) };
        changed = true;
        const t = gone[0].type;
        messages.push(`Removed ${gone.every((g) => g.type === t) ? plural(gone.length, itemLabel(t)) : `${gone.length} pieces`}.`);
        if (select && ids.has(select)) select = null;
        continue;
      }
      if (op.op === "add") {
        if (!ITEM_TYPES.includes(op.type)) {
          errors.push(`I don't know how to build "${op.type}".`);
          continue;
        }
        const variant = variantOf(op.type, op.variant);
        // One bed back per room: "add bed back" on a room that has one restyles it.
        if (op.type === "bedBack") {
          const existing = room.items.find((i) => i.type === "bedBack");
          if (existing) {
            existing.variant = op.variant ? variant : existing.variant;
            if (op.finish) existing.finish = op.finish;
            changed = true;
            select = existing.id;
            messages.push(`This room already has a bed back panel — set it to ${variantLabel(existing).toLowerCase()}.`);
            continue;
          }
        }
        const near = op.near ? room.items.find((i) => i.id === op.near) ?? null : null;
        let placements: { x: number; z: number; w: number; d: number; h: number; facing: Dir; elevation?: number }[];
        if (typeof op.x === "number" && typeof op.z === "number") {
          const s = CATALOG[op.type].size;
          placements = [
            {
              x: op.x,
              z: op.z,
              w: num(op.w, 0.05, 8) ?? s.w,
              d: num(op.d, 0.01, 8) ?? s.d,
              h: num(op.h, 0.005, 4) ?? s.h,
              facing: op.facing && DIRS.includes(op.facing) ? op.facing : "down",
              elevation: num(op.elevation, 0, 3),
            },
          ];
        } else {
          placements = placeNew(room, op.type, variant, { near, wall: op.wall ?? null, count: op.count });
          if (op.count && op.count > placements.length && op.type !== "nightstand") {
            for (let n = placements.length; n < op.count; n++) {
              const extra = placeNew({ ...room, items: [...room.items, ...placements.map((p, i) => ({ id: `tmp${i}`, type: op.type, variant, ...p }))] }, op.type, variant, { near, wall: op.wall ?? null });
              if (!extra.length) break;
              placements.push(extra[0]);
            }
          }
        }
        if (!placements.length) {
          errors.push(`There is no free spot for a ${itemLabel(op.type)}${op.wall ? ` on the ${op.wall} wall` : ""} — move or remove something first, or add it and drag it.`);
          continue;
        }
        const added: Item[] = [];
        for (const p of placements.slice(0, Math.max(1, op.count ?? placements.length))) {
          const it: Item = clampInside(room, {
            id: newId(room, op.type),
            type: op.type,
            variant,
            ...(op.finish ? { finish: op.finish } : {}),
            ...(op.label ? { label: op.label } : {}),
            x: round2(p.x),
            z: round2(p.z),
            w: round2(p.w),
            d: round2(p.d),
            h: round2(p.h),
            facing: p.facing,
            ...(p.elevation !== undefined ? { elevation: p.elevation } : {}),
          });
          room = { ...room, items: [...room.items, it] };
          added.push(it);
        }
        changed = true;
        select = added[added.length - 1].id;
        const a = added[0];
        const where = op.type === "bedBack" ? " on the wall behind the bed" : op.wall ? ` on the ${op.wall} wall` : "";
        messages.push(
          `Added ${added.length > 1 ? `${added.length} ${itemLabel(a.type)}s` : `${/^[aeiou]/i.test(itemLabel(a.type)) ? "an" : "a"} ${itemLabel(a.type)}`} — ${variantLabel(a).toLowerCase()}${a.finish ? `, ${a.finish}` : ""}, ${a.w.toFixed(2)} m wide${where}.`,
        );
        continue;
      }
      if (op.op === "update") {
        const targets = room.items.filter((i) => op.ids.includes(i.id));
        if (!targets.length) {
          errors.push("Nothing to change.");
          continue;
        }
        const notes = new Set<string>();
        for (const it0 of targets) {
          let it = { ...it0 };
          const vs = CATALOG[it.type].variants;
          if (op.nextVariant) {
            const i = vs.findIndex((v) => v.id === it.variant);
            it.variant = vs[(i + 1) % vs.length].id;
            notes.add(`design → ${variantLabel(it).toLowerCase()}`);
          } else if (op.variant) {
            if (vs.some((v) => v.id === op.variant)) {
              it.variant = op.variant;
              notes.add(`design → ${variantLabel(it).toLowerCase()}`);
            } else errors.push(`"${op.variant}" is not a ${itemLabel(it.type)} design.`);
          }
          if (op.finish === null) {
            delete it.finish;
            notes.add("finish reset to the room style");
          } else if (typeof op.finish === "string" && op.finish.trim()) {
            it.finish = op.finish.trim().slice(0, 40);
            notes.add(`finish → ${it.finish}`);
          }
          if (op.label) it.label = op.label.slice(0, 40);
          const scale = num(op.scale, 0.3, 3);
          if (scale) {
            const r = CATALOG[it.type].range;
            it.w = round2(clamp(it.w * scale, r.w[0] * 0.8, r.w[1] * 1.2));
            if (!CATALOG[it.type].wallMounted) it.d = round2(clamp(it.d * scale, r.d[0] * 0.8, r.d[1] * 1.2));
            notes.add(scale > 1 ? "made bigger" : "made smaller");
          }
          const w = num(op.w, 0.1, 8);
          const d = num(op.d, 0.01, 8);
          const h = num(op.h, 0.005, 4);
          if (w) it.w = round2(w);
          if (d) it.d = round2(d);
          if (h) it.h = round2(h);
          if (w || d || h) notes.add(`size ${it.w.toFixed(2)} × ${it.d.toFixed(2)} × ${it.h.toFixed(2)} m`);
          if (op.elevation !== undefined) {
            const e = num(op.elevation, 0, 3);
            if (e !== undefined) it.elevation = round2(e);
          }
          if (op.rotate) {
            it.facing = rotateDir(it.facing, op.rotate);
            notes.add(`turned to face ${planWord(it.facing)}`);
          }
          if (op.facing && DIRS.includes(op.facing)) {
            it.facing = op.facing;
            notes.add(`facing ${planWord(it.facing)}`);
          }
          if (op.wall && WALLS.includes(op.wall)) {
            const along = op.wall === "top" || op.wall === "bottom" ? it.x : it.z;
            const others = new Set([it.id]);
            const p =
              fitOnWall({ ...room, items: room.items.filter((i) => i.id !== it.id) }, op.wall, { w: it.w, d: it.d, h: it.h }, { prefer: along, except: others }) ??
              { ...againstWallAt(room, op.wall, clamp(along, it.w / 2, wallLen(room, op.wall) - it.w / 2), it.d, CATALOG[it.type].wallMounted ? 0 : WALL_CLEAR) };
            it = { ...it, x: p.x, z: p.z, facing: p.facing };
            notes.add(`moved to the ${op.wall} wall`);
          }
          const x = num(op.x, -1, 30);
          const z = num(op.z, -1, 30);
          if (x !== undefined) it.x = x;
          if (z !== undefined) it.z = z;
          if (op.dx) it.x += clamp(op.dx, -20, 20);
          if (op.dz) it.z += clamp(op.dz, -20, 20);
          if (x !== undefined || z !== undefined || op.dx || op.dz) notes.add("moved");
          it = clampInside(room, it);
          room = { ...room, items: room.items.map((i) => (i.id === it.id ? it : i)) };
        }
        if (notes.size) {
          changed = true;
          select = targets.length === 1 ? targets[0].id : select ?? targets[0].id;
          const t = targets[0].type;
          const who = targets.every((g) => g.type === t) ? plural(targets.length, itemLabel(t)) : `${targets.length} pieces`;
          messages.push(`${cap(who)}: ${[...notes].join(", ")}.`);
        }
        continue;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (changed) room = settle(room);
  return { room, messages, errors, select, shot, changed };
}

function rotateDir(d: Dir, deg: 90 | -90 | 180): Dir {
  const order: Dir[] = ["up", "right", "down", "left"];
  const i = order.indexOf(d);
  const step = deg === 180 ? 2 : deg === 90 ? 1 : 3;
  return order[(i + step) % 4];
}

function planWord(d: Dir): string {
  return d === "up" ? "the top wall" : d === "down" ? "the bottom wall" : `the ${d} wall`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------- parsing

export interface CommandContext {
  /** The piece currently selected in the 3D view / list. */
  selectedId: string | null;
  /** The piece the previous command touched ("delete that" right after "add a plant"). */
  lastId: string | null;
}

export interface ParseResult {
  ops: Op[];
  /** False when some part of the command was not understood (send it to the AI). */
  understood: boolean;
  /** A clause the parser could not read, for the error line. */
  unknown?: string;
}

const VERB = {
  add: /\b(add|put|place|insert|include|install|want|need|give me|bring in)\b/,
  remove: /\b(remove|delete|erase|take out|take away|get rid of|drop)\b|^(no|without)\b/,
  move: /\b(move|shift|push|slide|bring|relocate|reposition)\b/,
  rotate: /\b(rotate|turn|spin|flip|face|facing)\b/,
  change: /\b(change|replace|swap|switch|make|convert|use|update|redesign|restyle|style|try|another|different|set|paint|color|finish)\b/,
  resize: /\b(bigger|smaller|larger|wider|narrower|longer|shorter|taller|lower|higher|resize|increase|decrease|reduce|enlarge|shrink)\b/,
};

/** Words that start a new instruction; a clause without one continues the previous verb. */
const ACTION = /\b(add|put|place|insert|include|install|remove|delete|erase|take out|get rid of|move|shift|push|slide|rotate|turn|spin|flip|change|replace|swap|switch|make|convert|use|update|redesign|restyle|paint|set|show|take|want|need|give me|resize|increase|decrease|reduce)\b|^(no|without)\b/;

const SHOT_WORDS = /\b(shot|view|camera|angle|perspective|picture|photo|render from|look from|see from|show)\b/;

const STOP = new Set(["the", "a", "an", "of", "to", "with", "and", "in", "on", "for", "it", "its", "this", "that", "please", "unit", "table", "wood", "front", "top", "set", "shelf", "chair", "bed", "sofa"]);

/** Split "add a bed back and side tables, then make the bed walnut" into clauses with verbs. */
export function splitClauses(text: string): string[] {
  const parts = text
    .split(/\s*(?:[,;]|\.(?!\d)|\band then\b|\bthen\b|\balso\b|\band\b|\bplus\b|&)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let lastVerb = "";
  for (const p of parts) {
    const verb = p.match(ACTION)?.[0];
    if (verb) {
      lastVerb = verb;
      out.push(p);
    } else if (lastVerb && out.length) {
      // A bare noun continues the previous verb: "add a bed back and side tables".
      // A bare colour/finish continues the previous object: "make the bed walnut and the sofa green".
      out.push(`${lastVerb} ${p}`);
    } else out.push(p);
  }
  return out;
}

function parseLength(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|meters?|metres?|ft|feet|foot|'|inch(?:es)?|in\b|")/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2];
  if (u === "mm") return v / 1000;
  if (u === "cm") return v / 100;
  if (/^(ft|feet|foot|')$/.test(u)) return v * 0.3048;
  if (/^(inch|inches|in|")$/.test(u)) return v * 0.0254;
  return v;
}

/** "12 x 14 ft", "3.6 by 4.2 m" → [a, b] in metres. */
function parsePair(text: string): [number, number] | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet|m)?\s*(?:x|×|by|into|\*)\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|meters?|metres?|ft|feet|foot|'|")?/);
  if (!m) return null;
  const u = m[3] ?? (parseFloat(m[1]) > 8 ? "ft" : "m");
  const k = u === "mm" ? 0.001 : u === "cm" ? 0.01 : /^(ft|feet|foot|')$/.test(u) ? 0.3048 : u === '"' ? 0.0254 : 1;
  return [parseFloat(m[1]) * k, parseFloat(m[2]) * k];
}

function wallFrom(text: string): Wall | null {
  const m = text.match(/\b(top|bottom|left|right|north|south|east|west)\s+(?:side\s+)?wall\b/) ?? text.match(/\bwall\s+(?:on\s+the\s+)?(top|bottom|left|right)\b/);
  if (!m) return null;
  const w = m[1];
  return w === "north" ? "top" : w === "south" ? "bottom" : w === "east" ? "right" : w === "west" ? "left" : (w as Wall);
}

function colorFrom(text: string, raw = text): string | null {
  const hex = raw.match(/#[0-9a-f]{6}\b/);
  if (hex) return hex[0];
  let best: string | null = null;
  for (const k of Object.keys(COLOR_WORDS)) {
    if (new RegExp(`\\b${k.replace(/ /g, "\\s+")}\\b`).test(text) && (!best || k.length > best.length)) best = k;
  }
  return best ? COLOR_WORDS[best] : null;
}

function styleFrom(text: string): StyleId | null {
  if (/\b(scandi|scandinavian|nordic|japandi)\b/.test(text)) return "scandinavian";
  if (/\b(luxury|luxurious|premium|rich|glam|opulent)\b/.test(text)) return "luxury";
  if (/\b(minimal|minimalist|simple|clean)\b/.test(text)) return "minimal";
  if (/\b(indian|ethnic|traditional|desi)\b/.test(text)) return "indian-contemporary";
  if (/\b(modern warm|warm modern|modern|warm|contemporary)\b/.test(text)) return "modern-warm";
  return null;
}

function floorFrom(text: string): FloorFinish | null {
  if (/\b(marble|italian)\b/.test(text)) return "marble";
  if (/\b(tile|tiles|tiled|vitrified|porcelain)\b/.test(text)) return "tile";
  if (/\b(carpet|carpeted|wall to wall)\b/.test(text)) return "carpet";
  if (/\b(wood|wooden|laminate|parquet|hardwood|engineered)\b/.test(text)) return "wood";
  return null;
}

/** Best variant of `type` named in the text, or null. Variant ids count double. */
export function variantFrom(type: ItemType, text: string): string | null {
  let best: { id: string; score: number } | null = null;
  for (const v of CATALOG[type].variants) {
    let score = 0;
    const idWords = v.id.split("-").filter((w) => w.length > 2 && !STOP.has(w));
    if (idWords.length && idWords.every((w) => new RegExp(`\\b${w}`).test(text))) score += 2 * idWords.length;
    for (const w of normalize(v.label).split(" ")) {
      if (w.length > 2 && !STOP.has(w) && new RegExp(`\\b${w}\\b`).test(text)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: v.id, score };
  }
  return best?.id ?? null;
}

/** The finish words left once the item's name and design words are taken out. */
function finishFrom(type: ItemType | null, text: string, variant: string | null): string | null {
  let t = ` ${text} `;
  if (type) for (const a of CATALOG[type].aliases) t = t.replace(new RegExp(`\\b${normalize(a)}\\b`, "g"), " ");
  if (type && variant) {
    const v = CATALOG[type].variants.find((x) => x.id === variant);
    for (const w of [...variant.split("-"), ...normalize(v?.label ?? "").split(" ")]) if (w.length > 2) t = t.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  }
  const color = colorFrom(t);
  const mat = t.match(/\b(velvet|leather|linen|boucle|cane|rattan|glass|marble|granite|brass|gold|steel|chrome|walnut|oak|teak|ash|wenge|light wood|dark wood|white oak|light oak)\b/g);
  const words = [...(color ? [Object.entries(COLOR_WORDS).find(([, v]) => v === color)?.[0] ?? color] : []), ...(mat ?? [])];
  return words.length ? [...new Set(words)].join(" ") : null;
}

/** The item type a clause names, read in the room's context. */
function typeIn(room: RoomModel, clause: string): ItemType | null {
  const type = typeFromWords(clause);
  // Outside a bedroom a "side table" is an end table, not a bedside table.
  if (type === "nightstand" && !room.items.some((i) => i.type === "nightstand")) {
    const bedless = !room.items.some((i) => i.type === "bed") && room.kind !== "bedroom" && room.kind !== "kids";
    if (bedless || room.items.some((i) => i.type === "sideTable")) return "sideTable";
  }
  return type;
}

/** Which item(s) a clause refers to. */
function targetsOf(room: RoomModel, clause: string, raw: string, ctx: CommandContext, allByDefault: boolean): { items: Item[]; type: ItemType | null } {
  const deictic = /\b(that|this|it|selected|the selected one|same)\b/.test(clause);
  const type = typeIn(room, clause);
  if (!type && deictic) {
    const id = ctx.selectedId ?? ctx.lastId;
    const it = id ? room.items.find((i) => i.id === id) : null;
    return { items: it ? [it] : [], type: it?.type ?? null };
  }
  if (!type) return { items: [], type: null };
  let items = room.items.filter((i) => i.type === type);
  if (items.length <= 1) return { items, type };
  const sel = ctx.selectedId ? items.find((i) => i.id === ctx.selectedId) : undefined;
  if (deictic && sel) return { items: [sel], type };
  // "the left side table": left as seen standing in front of the main piece.
  const qual = clause.match(/\b(left|right)\b(?!\s+(?:side\s+)?wall)/);
  if (qual && !/\b(move|shift|push|slide)\b/.test(clause)) {
    // Viewer's left, standing in front of the main piece and looking at it.
    const anchor = mainItem(room) ?? items[0];
    const f = dirVec(anchor.facing);
    const left: [number, number] = [-f[1], f[0]];
    const score = (it: Item) => it.x * left[0] + it.z * left[1];
    items = [...items].sort((a, b) => score(b) - score(a));
    return { items: [qual[1] === "left" ? items[0] : items[items.length - 1]], type };
  }
  const isPlural = new RegExp(`\\b(${CATALOG[type].aliases.map((a) => normalize(a)).join("|")})(s|es)\\b`).test(raw) || /\b(all|both|every|each|the two|pair)\b/.test(raw);
  if (isPlural || allByDefault) return { items, type };
  return { items: [sel ?? items[items.length - 1]], type };
}

function shotFrom(clause: string): string | null {
  if (/\b(next|other|another|different)\s+(shot|view|angle)\b/.test(clause)) return "next";
  if (/\b(top|plan|above|bird|overhead)\b/.test(clause)) return "top";
  if (/\b(corner)\b/.test(clause)) return "corner";
  if (/\b(bed back|behind the bed|headboard|sofa back|behind the sofa|back of the|from the back|main element|over the)\b/.test(clause)) return "back";
  if (/\b(facing|front|opposite|straight on)\b/.test(clause)) return "front";
  if (/\b(entry|entrance|main door|door|doorway|walk in|walking in|enter)\b/.test(clause)) return "entry";
  return null;
}

/** Parse one plain-English command into operations. */
export function parseCommand(room: RoomModel, text: string, ctx: CommandContext): ParseResult {
  const ops: Op[] = [];
  const raw = text.toLowerCase().replace(/colour/g, "color").replace(/centre/g, "center").replace(/[’']/g, "'");
  for (const clause0 of splitClauses(raw)) {
    let clause = normalize(clause0).replace(/\bbedback\b/g, "bed back");
    // "move the bed back 20 cm" moves the bed backwards; it is not the bed back panel.
    if (VERB.move.test(clause) && !/\bpanel\b/.test(clause)) clause = clause.replace(/\bbed back\b/, "bed backward");
    const has = (re: RegExp) => re.test(clause);
    const type = typeIn(room, clause);

    // Camera: "show the bed back view", "take a shot from the door", "next shot".
    if (has(SHOT_WORDS) && !has(VERB.add) && !has(VERB.remove)) {
      const s = shotFrom(clause);
      if (s) {
        ops.push({ op: "shot", shot: s });
        continue;
      }
    }

    // Room-level edits.
    if (/\b(false ceiling|pop ceiling|gypsum ceiling|cove)\b/.test(clause)) {
      ops.push({ op: "room", falseCeiling: !has(VERB.remove) && !/\b(plain|flat)\b/.test(clause) });
      continue;
    }
    if (/\b(curtain|drape|blind)\b/.test(clause) && !type) {
      ops.push({ op: "room", curtains: !has(VERB.remove) });
      continue;
    }
    if (/\bceiling\b/.test(clause) && /\b(height|high|tall)\b/.test(clause)) {
      const h = parseLength(clause0);
      if (h) {
        ops.push({ op: "room", height: h });
        continue;
      }
    }
    if (/\broom\b/.test(clause) && !type) {
      const p = parsePair(clause0);
      if (p) {
        ops.push({ op: "room", width: p[0], depth: p[1] });
        continue;
      }
    }
    if (/\b(floor|flooring)\b/.test(clause) && !type) {
      const f = floorFrom(clause.replace(/\bfloor(ing)?\b/g, ""));
      if (f) {
        ops.push({ op: "room", floor: f });
        continue;
      }
    }
    if (/\b(wall|walls|paint)\b/.test(clause) && !type && !wallFrom(clause)) {
      const c = colorFrom(clause, clause0);
      if (c) {
        ops.push({ op: "room", wallColor: c });
        continue;
      }
    }
    if (!type && (/\b(style|theme|look|interior|design|room|everything)\b/.test(clause) || /\b(scandi|scandinavian|nordic|japandi|luxury|luxurious|minimalist|indian)\b/.test(clause))) {
      const s = styleFrom(clause);
      if (s) {
        ops.push({ op: "room", style: s });
        continue;
      }
    }

    // Delete: "delete that", "remove the side tables", "no rug".
    if (has(VERB.remove) && !has(/\b(add|put|place)\b/)) {
      const t = targetsOf(room, clause, clause0, ctx, false);
      if (t.items.length) {
        ops.push({ op: "remove", ids: t.items.map((i) => i.id) });
        continue;
      }
      if (t.type || /\b(that|this|it|selected)\b/.test(clause)) {
        ops.push({ op: "remove", ids: [] });
        continue;
      }
      return { ops, understood: false, unknown: clause0 };
    }

    // Add: "add a bed back", "add side tables", "put a plant in the corner", "add a walnut wardrobe on the left wall".
    const addVerb = clause.match(VERB.add)?.[0] ?? "";
    // "I want the bed in walnut" restyles the bed; "I want a bed back" adds one.
    const softAdd =
      /^(want|need|give me)$/.test(addVerb) &&
      type !== null &&
      type !== "bedBack" &&
      room.items.some((i) => i.type === type) &&
      !/\b(another|new|more|extra|second|one more|also)\b/.test(clause) &&
      Boolean(variantFrom(type, clause) || finishFrom(type, clause, null));
    if (addVerb && type && !softAdd) {
      const variant = variantFrom(type, clause);
      const finish = finishFrom(type, clause, variant);
      const count = /\b(two|2|pair|both)\b/.test(clause)
        ? 2
        : /\b(three|3)\b/.test(clause)
          ? 3
          : type === "nightstand"
            ? /\b(side table|bedside table|nightstand|night stand)s\b/.test(clause0)
              ? 2
              : /\b(a|one|single)\b/.test(clause)
                ? 1
                : undefined
            : undefined;
      const behind = clause.match(/\b(?:behind|near|next to|beside|in front of|opposite|facing|by)\s+(?:the\s+)?([a-z ]+)/);
      const nearType = behind ? typeFromWords(behind[1]) : null;
      const near = nearType ? room.items.find((i) => i.type === nearType)?.id : undefined;
      ops.push({ op: "add", type, ...(variant ? { variant } : {}), ...(finish ? { finish } : {}), ...(wallFrom(clause) ? { wall: wallFrom(clause)! } : {}), ...(near ? { near } : {}), ...(count ? { count } : {}) });
      continue;
    }

    const t = targetsOf(room, clause, clause0, ctx, !/\b(one|single)\b/.test(clause));
    if (!t.items.length) {
      if (t.type && has(VERB.change)) {
        // "change the bed back to marble" in a room without one → add it.
        const variant = variantFrom(t.type, clause);
        const finish = finishFrom(t.type, clause, variant);
        ops.push({ op: "add", type: t.type, ...(variant ? { variant } : {}), ...(finish ? { finish } : {}) });
        continue;
      }
      return { ops, understood: false, unknown: clause0 };
    }
    const ids = t.items.map((i) => i.id);
    const first = t.items[0];

    // Rotate: "rotate the bed", "turn the sofa to face the tv".
    if (has(/\b(rotate|spin|turn around|flip)\b/) || (has(/\b(face|facing|turn)\b/) && has(/\b(towards?|to face|the)\b/) && !has(VERB.move))) {
      const toward = clause.match(/\b(?:face|facing|towards?)\s+(?:the\s+)?([a-z ]+)/);
      if (toward) {
        const goal = facingGoal(room, toward[1], first);
        if (goal) {
          ops.push({ op: "update", ids, facing: goal });
          continue;
        }
      }
      ops.push({ op: "update", ids, rotate: has(/\b180|around|flip\b/) ? 180 : has(/\b(anti|counter)/) ? -90 : 90 });
      continue;
    }

    // Move: "move the bed 30 cm left", "move the wardrobe to the right wall", "shift the sofa forward".
    if (has(VERB.move)) {
      const wall = wallFrom(clause);
      if (wall) {
        ops.push({ op: "update", ids, wall });
        continue;
      }
      const amt = parseLength(clause0) ?? (has(/\b(little|bit|slightly)\b/) ? 0.15 : 0.3);
      const f = dirVec(first.facing);
      let v: [number, number] | null = null;
      if (has(/\b(forward|forwards|ahead|out)\b/)) v = f;
      else if (has(/\b(back|backward|backwards|closer to the wall|against the wall)\b/)) v = [-f[0], -f[1]];
      else if (has(/\bleft\b/)) v = [-1, 0];
      else if (has(/\bright\b/)) v = [1, 0];
      else if (has(/\b(up|top|north)\b/)) v = [0, -1];
      else if (has(/\b(down|bottom|south)\b/)) v = [0, 1];
      else {
        const toward = clause.match(/\b(?:towards?|closer to|near|next to)\s+(?:the\s+)?([a-z ]+)/);
        const other = toward ? itemOrOpening(room, toward[1], first.id) : null;
        if (other) {
          const dx = other.x - first.x;
          const dz = other.z - first.z;
          const len = Math.hypot(dx, dz) || 1;
          v = [dx / len, dz / len];
        }
      }
      if (v) {
        ops.push({ op: "update", ids, dx: round2(v[0] * amt), dz: round2(v[1] * amt) });
        continue;
      }
      return { ops, understood: false, unknown: clause0 };
    }

    // Resize: "make the wardrobe 2.4 m wide", "bed bigger", "taller".
    if (has(VERB.resize) || (has(/\b(wide|width|deep|depth|long|length|high|height|tall)\b/) && parseLength(clause0))) {
      const L = parseLength(clause0);
      if (L && has(/\b(wide|width)\b/)) ops.push({ op: "update", ids, w: L });
      else if (L && has(/\b(deep|depth|long|length)\b/)) ops.push({ op: "update", ids, d: L });
      else if (L && has(/\b(high|height|tall)\b/)) ops.push({ op: "update", ids, h: L });
      else if (has(/\b(wider)\b/)) ops.push({ op: "update", ids, w: round2(first.w + (L ?? first.w * 0.15)) });
      else if (has(/\b(narrower)\b/)) ops.push({ op: "update", ids, w: round2(first.w - (L ?? first.w * 0.13)) });
      else if (has(/\b(taller|higher)\b/)) ops.push({ op: "update", ids, h: round2(first.h + (L ?? first.h * 0.15)) });
      else if (has(/\b(shorter|lower)\b/)) ops.push({ op: "update", ids, h: round2(first.h - (L ?? first.h * 0.13)) });
      else if (has(/\b(longer)\b/)) ops.push({ op: "update", ids, d: round2(first.d + (L ?? first.d * 0.15)) });
      else ops.push({ op: "update", ids, scale: has(/\b(smaller|reduce|decrease|shrink)\b/) ? 0.87 : 1.15 });
      continue;
    }

    // Change design / finish: "change the bed design", "make the side tables round", "sofa in emerald velvet".
    if (has(VERB.change) || has(/\b(design|look|model|type)\b/) || colorFrom(clause, clause0) || finishFrom(t.type, clause, null)) {
      const variant = t.type ? variantFrom(t.type, clause) : null;
      const finish = finishFrom(t.type, clause, variant);
      if (variant || finish) {
        ops.push({ op: "update", ids, ...(variant ? { variant } : {}), ...(finish ? { finish } : {}) });
        continue;
      }
      if (has(/\b(design|style|model|type|look|another|different|change|replace|swap|redesign|next)\b/)) {
        ops.push({ op: "update", ids, nextVariant: true });
        continue;
      }
    }
    return { ops, understood: false, unknown: clause0 };
  }
  return { ops, understood: ops.length > 0 };
}

function itemOrOpening(room: RoomModel, words: string, exceptId: string): { x: number; z: number } | null {
  const tp = typeFromWords(words);
  const it = tp ? room.items.find((i) => i.type === tp && i.id !== exceptId) : null;
  if (it) return it;
  const w = normalize(words);
  const kind = /\bwindow\b/.test(w) ? "window" : /\bdoor\b/.test(w) ? "door" : null;
  const o = kind ? room.openings.find((x) => x.kind === kind || (kind === "door" && x.kind === "sliding")) : null;
  if (!o) return null;
  const c = o.wall === "top" ? { x: o.offset, z: 0 } : o.wall === "bottom" ? { x: o.offset, z: room.depth } : o.wall === "left" ? { x: 0, z: o.offset } : { x: room.width, z: o.offset };
  return c;
}

function facingGoal(room: RoomModel, words: string, it: Item): Dir | null {
  const w = wallFrom(words) ?? (/\b(top|bottom|left|right)\b/.exec(words)?.[1] as Wall | undefined) ?? null;
  if (w) return w === "top" ? "up" : w === "bottom" ? "down" : w;
  const other = itemOrOpening(room, words, it.id);
  if (!other) return null;
  return dirFromVec([other.x - it.x, other.z - it.z]);
}

/** Parse + apply. The UI's single entry point for typed commands. */
export function runCommand(room: RoomModel, text: string, ctx: CommandContext): ApplyResult & { understood: boolean; unknown?: string } {
  const parsed = parseCommand(room, text, ctx);
  const res = applyOps(room, parsed.ops);
  // "delete that" with nothing selected.
  if (parsed.ops.some((o) => o.op === "remove" && !o.ids.length)) {
    res.errors.push("Select the piece first (click it in the 3D view or the list), or name it — e.g. “delete the plant”.");
  }
  return { ...res, understood: parsed.understood, unknown: parsed.unknown };
}

// ---------------------------------------------------- AI-proposed operations

/** Validate operations proposed by the AI (untrusted JSON) against the room. */
export function sanitizeOps(room: RoomModel, raw: unknown): Op[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { ops?: unknown }).ops) ? (raw as { ops: unknown[] }).ops : [];
  const ids = new Set(room.items.map((i) => i.id));
  const out: Op[] = [];
  const str = (v: unknown, n = 40) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const wall = (v: unknown) => (WALLS.includes(v as Wall) ? (v as Wall) : undefined);
  const dir = (v: unknown) => (DIRS.includes(v as Dir) ? (v as Dir) : undefined);
  for (const r of list.slice(0, 30)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const idList = (Array.isArray(o.ids) ? o.ids : typeof o.id === "string" ? [o.id] : []).filter((x): x is string => typeof x === "string" && ids.has(x));
    switch (o.op) {
      case "add": {
        const type = ITEM_TYPES.includes(o.type as ItemType) ? (o.type as ItemType) : typeof o.type === "string" ? typeFromWords(o.type) : null;
        if (!type) break;
        out.push({
          op: "add",
          type,
          variant: str(o.variant),
          finish: str(o.finish),
          wall: wall(o.wall),
          near: typeof o.near === "string" && ids.has(o.near) ? o.near : undefined,
          count: n(o.count) ? clamp(Math.round(n(o.count)!), 1, 6) : undefined,
          x: n(o.x),
          z: n(o.z),
          w: n(o.w),
          d: n(o.d),
          h: n(o.h),
          facing: dir(o.facing),
          elevation: n(o.elevation),
          label: str(o.label),
        });
        break;
      }
      case "remove":
        if (idList.length) out.push({ op: "remove", ids: idList });
        break;
      case "update": {
        if (!idList.length) break;
        const rot = n(o.rotate);
        out.push({
          op: "update",
          ids: idList,
          variant: str(o.variant),
          nextVariant: o.nextVariant === true ? true : undefined,
          finish: o.finish === null ? null : str(o.finish),
          x: n(o.x),
          z: n(o.z),
          dx: n(o.dx),
          dz: n(o.dz),
          w: n(o.w),
          d: n(o.d),
          h: n(o.h),
          scale: n(o.scale),
          facing: dir(o.facing),
          rotate: rot === 90 || rot === -90 || rot === 180 ? rot : undefined,
          wall: wall(o.wall),
          elevation: n(o.elevation),
          label: str(o.label),
        });
        break;
      }
      case "room":
        out.push({
          op: "room",
          wallColor: typeof o.wallColor === "string" && /^#[0-9a-f]{6}$/i.test(o.wallColor) ? o.wallColor : undefined,
          floor: ["wood", "tile", "marble", "carpet"].includes(o.floor as string) ? (o.floor as FloorFinish) : undefined,
          falseCeiling: typeof o.falseCeiling === "boolean" ? o.falseCeiling : undefined,
          curtains: typeof o.curtains === "boolean" ? o.curtains : undefined,
          height: n(o.height),
          style: STYLE_IDS.includes(o.style as StyleId) ? (o.style as StyleId) : undefined,
          width: n(o.width),
          depth: n(o.depth),
        });
        break;
      case "shot":
        if (typeof o.shot === "string") out.push({ op: "shot", shot: o.shot.slice(0, 20) });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Facing that turns a piece's back to the wall it is nearest (used after AI moves). */
export function facingFromWall(w: Wall): Dir {
  return opposite(w === "top" ? "up" : w === "bottom" ? "down" : w);
}

export { wallOfDir, footprint };
