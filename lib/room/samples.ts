// Ready-made rooms: the "try a sample" buttons on the landing page, and the
// fixtures the renderer is checked against. Real Indian apartment sizes.

import type { RoomModel } from "./types";

export const SAMPLE_BEDROOM: RoomModel = {
  version: 1,
  name: "Master bedroom",
  kind: "bedroom",
  width: 3.66,
  depth: 4.27,
  height: 3.0,
  falseCeiling: true,
  curtains: true,
  floor: "wood",
  wallColor: "#ece6dc",
  style: "modern-warm",
  scaleSource: "manual",
  openings: [
    { id: "d1", kind: "door", wall: "bottom", offset: 3.0, width: 0.9, height: 2.1, sill: 0, main: true },
    { id: "w1", kind: "window", wall: "left", offset: 2.2, width: 1.5, height: 1.35, sill: 0.9 },
  ],
  items: [
    { id: "bedback", type: "bedBack", variant: "fluted", x: 1.83, z: 0.03, w: 3.0, d: 0.06, h: 2.4, facing: "down" },
    { id: "bed", type: "bed", variant: "upholstered", x: 1.83, z: 1.12, w: 1.8, d: 2.1, h: 1.15, facing: "down" },
    { id: "ns1", type: "nightstand", variant: "two-drawer", x: 0.63, z: 0.28, w: 0.5, d: 0.42, h: 0.5, facing: "down" },
    { id: "ns2", type: "nightstand", variant: "two-drawer", x: 3.03, z: 0.28, w: 0.5, d: 0.42, h: 0.5, facing: "down" },
    { id: "wardrobe", type: "wardrobe", variant: "hinged-loft", x: 3.36, z: 2.45, w: 1.8, d: 0.6, h: 2.1, facing: "left" },
    { id: "tv", type: "tvUnit", variant: "floating", x: 1.15, z: 4.06, w: 1.6, d: 0.42, h: 0.45, facing: "up" },
    { id: "rug", type: "rug", variant: "patterned", x: 1.83, z: 1.75, w: 2.4, d: 1.7, h: 0.012, facing: "down" },
    { id: "plant", type: "plant", variant: "tall", x: 0.35, z: 3.85, w: 0.5, d: 0.5, h: 1.5, facing: "down" },
  ],
};

export const SAMPLE_LIVING: RoomModel = {
  version: 1,
  name: "Living room",
  kind: "living",
  width: 4.5,
  depth: 5.5,
  height: 3.0,
  falseCeiling: true,
  curtains: true,
  floor: "tile",
  wallColor: "#efe7da",
  style: "indian-contemporary",
  scaleSource: "manual",
  openings: [
    { id: "d1", kind: "door", wall: "bottom", offset: 0.8, width: 1.0, height: 2.1, sill: 0, main: true },
    { id: "s1", kind: "sliding", wall: "top", offset: 3.0, width: 1.8, height: 2.1, sill: 0 },
    { id: "w1", kind: "window", wall: "left", offset: 1.0, width: 1.2, height: 1.35, sill: 0.9 },
  ],
  items: [
    { id: "sofa", type: "sofa", variant: "three-seater", x: 0.5, z: 2.75, w: 2.4, d: 0.95, h: 0.82, facing: "right" },
    { id: "art", type: "artwork", variant: "triptych", x: 0.02, z: 2.75, w: 1.5, d: 0.04, h: 0.6, facing: "right", elevation: 1.3 },
    { id: "tv", type: "tvUnit", variant: "panel", x: 4.29, z: 2.75, w: 2.6, d: 0.42, h: 0.45, facing: "left" },
    { id: "ct", type: "coffeeTable", variant: "rectangular", x: 1.85, z: 2.75, w: 1.1, d: 0.6, h: 0.4, facing: "right" },
    { id: "rug", type: "rug", variant: "patterned", x: 2.0, z: 2.75, w: 2.6, d: 2.0, h: 0.012, facing: "right" },
    { id: "ac", type: "armchair", variant: "lounge", x: 2.3, z: 1.25, w: 0.8, d: 0.82, h: 0.85, facing: "down" },
    { id: "lamp", type: "floorLamp", variant: "drum", x: 0.35, z: 1.25, w: 0.4, d: 0.4, h: 1.6, facing: "down" },
    { id: "plant", type: "plant", variant: "tall", x: 4.15, z: 0.45, w: 0.5, d: 0.5, h: 1.6, facing: "down" },
    { id: "sb", type: "sideboard", variant: "cane", x: 3.4, z: 5.27, w: 1.6, d: 0.45, h: 0.8, facing: "up" },
  ],
};

export const SAMPLES: { id: string; label: string; room: RoomModel }[] = [
  { id: "bedroom", label: "Sample bedroom (12′ × 14′)", room: SAMPLE_BEDROOM },
  { id: "living", label: "Sample living room (4.5 × 5.5 m)", room: SAMPLE_LIVING },
];
