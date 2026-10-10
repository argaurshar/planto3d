// Furniture dispatch: one builder per item type, all sharing a build context.

import type { Item, ItemType, RoomModel, StyleId } from "../types";
import type { Kit } from "../kit";
import type { Materials } from "../materials";
import type { Palette } from "../styles";
import { artwork, armchair, bookshelf, coffeeTable, floorLamp, mirror, ottoman, plant, rug, sideTable, sideboard, sofa, tvUnit } from "./living";
import { bed, bedBack, bench, dresser, nightstand, wardrobe } from "./bedroom";
import { bathtub, chair, desk, diningSet, fridge, genericBox, kitchenCounter, shower, toilet, vanity } from "./other";
import { ac, ceilingFan } from "./fixtures";

type Group = import("three").Group;

export interface BuildCtx {
  k: Kit;
  m: Materials;
  p: Palette;
  style: StyleId;
  room: RoomModel;
  /** Height of the lowest ceiling surface over the room (under a false ceiling). */
  ceilingClear: number;
}

type Builder = (c: BuildCtx, it: Item, g: Group) => void;

const BUILDERS: Record<ItemType, Builder> = {
  bed,
  bedBack,
  nightstand,
  wardrobe,
  dresser,
  tvUnit,
  sofa,
  armchair,
  coffeeTable,
  sideTable,
  ottoman,
  diningSet,
  desk,
  chair,
  bookshelf,
  sideboard,
  rug,
  plant,
  floorLamp,
  artwork,
  mirror,
  kitchenCounter,
  fridge,
  toilet,
  vanity,
  shower,
  bathtub,
  bench,
  ceilingFan,
  ac,
  other: genericBox,
};

/** Rotation about y that turns a piece's local front (+z) to face `facing` in plan. */
export function facingRotation(facing: Item["facing"]): number {
  switch (facing) {
    case "up":
      return Math.PI;
    case "left":
      return -Math.PI / 2;
    case "right":
      return Math.PI / 2;
    default:
      return 0;
  }
}

/** Build one item, placed and turned in room coordinates. */
export function buildItem(c: BuildCtx, it: Item): Group {
  const g = c.k.group();
  g.name = `item:${it.id}`;
  g.userData.itemId = it.id;
  const build = BUILDERS[it.type] ?? genericBox;
  build(c, it, g);
  // These builders set their own height (hung on the wall, or from the ceiling).
  const selfLifted = it.type === "artwork" || it.type === "mirror" || it.type === "ac" || it.type === "ceilingFan";
  g.position.set(it.x, selfLifted ? 0 : it.elevation ?? 0, it.z);
  g.rotation.y = facingRotation(it.facing);
  // Every mesh knows which item it belongs to, for click-to-select.
  g.traverse((o) => {
    o.userData.itemId = it.id;
  });
  return g;
}
