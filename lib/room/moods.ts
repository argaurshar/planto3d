// Lighting moods: the same room by day, in the evening and at night. One spec
// per mood drives the live 3D view and every raw shot (sun, sky light at the
// windows, the view outside, lamp strength, exposure), the Blender export
// (world colour and strength, exposure; the lights come from the same scene)
// and the words the realistic pass is given, so all three agree.

import type { Mood, RoomModel } from "./types";

export type { Mood };
export const MOODS: Mood[] = ["day", "evening", "night"];

export interface MoodSpec {
  label: string;
  icon: string;
  /** The sun through the biggest window: colour, intensity (0 = no sun), height of its position. */
  sun: { color: string; intensity: number; height: number };
  /** Soft sky light panel at every window. */
  sky: { color: string; intensity: number };
  /** Hemisphere fill. */
  fill: { sky: string; ground: string; intensity: number };
  /** Scale on lamps, cove LEDs, downlights and glowing surfaces. */
  lamps: number;
  /** Image-based light from the studio environment map. */
  env: number;
  /** Tone-mapping exposure of the live view and the raw shots. */
  exposure: number;
  /** Blender: world colour and strength, view exposure (AgX). */
  world: { color: [number, number, number]; strength: number };
  blenderExposure: number;
  /** How the realistic pass should light the photograph. */
  words: string;
}

export const MOOD_SPECS: Record<Mood, MoodSpec> = {
  day: {
    label: "Day",
    icon: "☀️",
    sun: { color: "#fff0d9", intensity: 2.6, height: 6.5 },
    sky: { color: "#e8f0ff", intensity: 4.5 },
    fill: { sky: "#fdf8f0", ground: "#b9a68f", intensity: 0.35 },
    lamps: 1,
    env: 0.45,
    exposure: 0.85,
    world: { color: [0.78, 0.84, 0.95], strength: 0.6 },
    blenderExposure: 0.3,
    words:
      "Daytime: soft natural daylight from the windows with physically correct soft shadows, bounce light and ambient occlusion, a gentle warm glow from the lights that are on.",
  },
  evening: {
    label: "Evening",
    icon: "🌇",
    sun: { color: "#ff9a52", intensity: 1.5, height: 1.9 },
    sky: { color: "#c7a9c9", intensity: 1.4 },
    fill: { sky: "#f3d9c4", ground: "#8a6f58", intensity: 0.16 },
    lamps: 1.2,
    env: 0.2,
    exposure: 1.0,
    world: { color: [0.95, 0.6, 0.42], strength: 0.22 },
    blenderExposure: 0.35,
    words:
      "Early evening at golden hour: a low warm orange sun grazing in through the window and dusky sky outside, with every lamp, cove light and downlight on, warm cosy pools of light and soft long shadows.",
  },
  night: {
    label: "Night",
    icon: "🌙",
    sun: { color: "#ffffff", intensity: 0, height: 6.5 },
    sky: { color: "#22325a", intensity: 0.3 },
    fill: { sky: "#1c2338", ground: "#2a2018", intensity: 0.05 },
    lamps: 1.35,
    env: 0.06,
    exposure: 1.15,
    world: { color: [0.02, 0.03, 0.07], strength: 0.08 },
    blenderExposure: 0.4,
    words:
      "Night: dark night sky outside the windows and no daylight at all; the room is lit only by its own lamps, cove LEDs and downlights — warm light pools, glowing lampshades, deep soft shadows between them.",
  },
};

export function moodOf(room: Pick<RoomModel, "mood">): Mood {
  return room.mood && MOODS.includes(room.mood) ? room.mood : "day";
}

export function moodSpec(room: Pick<RoomModel, "mood">): MoodSpec {
  return MOOD_SPECS[moodOf(room)];
}

/** "evening light", "make it night", "daylight", "golden hour" → a mood, or null. */
export function moodFromWords(text: string): Mood | null {
  if (/\b(night|nighttime|midnight|dark outside)\b/.test(text)) return "night";
  if (/\b(evening|dusk|sunset|golden hour|twilight)\b/.test(text)) return "evening";
  if (/\b(day|daylight|daytime|morning|noon|afternoon|sunny|sunlight)\b/.test(text)) return "day";
  return null;
}
