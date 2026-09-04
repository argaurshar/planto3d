"use client";

import { useEffect, useRef, useState } from "react";
import PlanUploader from "./PlanUploader";

/**
 * Landing hero for the upload step: a headline, the upload call-to-action, and
 * a LIVE demo of the pipeline drawn purely in CSS/SVG (no images, no extra
 * dependencies). The demo auto-plays through the four stages — upload → 3D
 * overview → pick a room → photoreal render — and is fully interactive: hover
 * pauses it, the stage tabs are clickable, and clicking a room on the plan
 * previews that room. The miniature plan extrudes into real CSS 3D walls, which
 * is the single clearest way to say "2D plan in, 3D out".
 */

interface Room {
  id: string;
  name: string;
  x: number; // % of floor width
  y: number; // % of floor height
  w: number;
  h: number;
  tint: string;
  /** Furniture blocks in the app's Layout-lock colour legend, % of the room. */
  furniture?: { x: number; y: number; w: number; h: number; color: string }[];
  /** Openings on the room's outer edge: side + position along it (%). */
  openings?: { side: "n" | "s" | "e" | "w"; at: number; len: number; kind: "window" | "door" }[];
}

const ROOMS: Room[] = [
  {
    id: "living",
    name: "Living room",
    x: 0, y: 0, w: 58, h: 62,
    tint: "rgba(255,255,255,0.05)",
    furniture: [
      { x: 30, y: 58, w: 40, h: 16, color: "#16a34a" }, // sofa (green = seating)
      { x: 36, y: 34, w: 26, h: 14, color: "#ca8a04" }, // coffee table (amber)
      { x: 8, y: 10, w: 22, h: 46, color: "#ca8a04" }, // dining table
    ],
    openings: [
      { side: "w", at: 10, len: 30, kind: "window" },
      { side: "w", at: 55, len: 30, kind: "window" },
      { side: "n", at: 20, len: 30, kind: "window" },
    ],
  },
  {
    id: "kitchen",
    name: "Kitchen",
    x: 58, y: 0, w: 42, h: 34,
    tint: "rgba(255,255,255,0.05)",
    furniture: [{ x: 6, y: 8, w: 88, h: 22, color: "#ea580c" }], // counter run (orange = storage)
    openings: [{ side: "n", at: 30, len: 40, kind: "window" }],
  },
  {
    id: "bath",
    name: "Bathroom",
    x: 58, y: 34, w: 18, h: 30,
    tint: "rgba(255,255,255,0.05)",
    furniture: [
      { x: 12, y: 12, w: 34, h: 30, color: "#0d9488" }, // sink (teal = bath)
      { x: 54, y: 52, w: 34, h: 34, color: "#0d9488" }, // toilet
    ],
    openings: [{ side: "e", at: 30, len: 40, kind: "door" }],
  },
  {
    id: "hall",
    name: "Hallway",
    x: 76, y: 34, w: 24, h: 30,
    tint: "rgba(255,255,255,0.03)",
    openings: [{ side: "e", at: 25, len: 45, kind: "window" }],
  },
  {
    id: "bedroom",
    name: "Bedroom",
    x: 58, y: 64, w: 42, h: 36,
    tint: "rgba(37,99,235,0.10)",
    furniture: [
      { x: 30, y: 30, w: 40, h: 62, color: "#2563eb" }, // bed (blue)
      { x: 8, y: 8, w: 18, h: 60, color: "#ea580c" }, // wardrobe (orange)
      { x: 76, y: 66, w: 14, h: 18, color: "#ca8a04" }, // nightstand (amber)
    ],
    openings: [
      { side: "e", at: 30, len: 40, kind: "window" },
      { side: "n", at: 8, len: 22, kind: "door" },
    ],
  },
  {
    id: "balcony",
    name: "Balcony",
    x: 0, y: 62, w: 58, h: 38,
    tint: "rgba(95,224,176,0.06)",
    furniture: [{ x: 8, y: 30, w: 24, h: 40, color: "#16a34a" }],
  },
];

const STAGES = [
  {
    title: "Upload a 2D plan",
    body: "Any floor plan image. The plan stays the geometric source of truth for everything that follows.",
  },
  {
    title: "Get a 3D overview",
    body: "AI extrudes the whole home into an axonometric view in your chosen style — walls, rooms and furniture in one shot.",
  },
  {
    title: "Draw a box around a room",
    body: "Pick any room straight off the plan. Its furniture, windows and doors are detected and locked into a 3D layout.",
  },
  {
    title: "Get a photoreal interior",
    body: "An eye-level render of that room, then checked against your plan and marked Verified — regenerate until you love it.",
  },
] as const;

const STAGE_MS = 4200;

interface Props {
  onPlanSelected: (dataUrl: string) => void;
}

export default function Hero({ onPlanSelected }: Props) {
  const [stage, setStage] = useState(0);
  const [room, setRoom] = useState("bedroom");
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const uploaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (paused || reduced) return;
    const t = setTimeout(() => setStage((s) => (s + 1) % STAGES.length), STAGE_MS);
    return () => clearTimeout(t);
  }, [stage, paused, reduced]);

  const focus = ROOMS.find((r) => r.id === room) ?? ROOMS[4];
  const is3d = stage === 1;
  const selecting = stage === 2;
  const rendering = stage === 3;

  function pickRoom(id: string) {
    setRoom(id);
    setStage(2);
  }

  return (
    <section className="space-y-8 sm:space-y-10">
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        {/* ---------- Copy + CTA ---------- */}
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            2D plan → 3D home → photoreal rooms
          </span>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3rem] xl:text-[3.4rem]">
            See your floor plan
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-sky-400 bg-clip-text text-transparent">
              as a real home.
            </span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-neutral-300 sm:text-lg">
            Upload any 2D floor plan. Voxa lifts it into a 3D overview, then
            lets you step into any room as a photorealistic, eye-level interior
            — laid out exactly as your plan says, and verified against it.
          </p>
          <ul className="grid gap-2 text-sm text-neutral-400 sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <Check /> Plan-accurate walls, windows and doors
            </li>
            <li className="flex items-start gap-2">
              <Check /> Editable AI prompt, unlimited regenerates
            </li>
            <li className="flex items-start gap-2">
              <Check /> Every render checked and marked Verified
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              className="btn-primary text-base"
              onClick={() =>
                uploaderRef.current?.querySelector<HTMLButtonElement>("button")?.click()
              }
            >
              Upload your plan
              <Arrow />
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setStage(0);
                document.getElementById("hero-demo")?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              Watch how it works
            </button>
          </div>
        </div>

        {/* ---------- Live demo ---------- */}
        <div
          id="hero-demo"
          className="card overflow-hidden"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {/* Stage tabs */}
          <div className="grid grid-cols-4 gap-1 border-b border-white/10 p-2" role="tablist" aria-label="How Voxa works">
            {STAGES.map((s, i) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={stage === i}
                type="button"
                onClick={() => setStage(i)}
                className={`relative overflow-hidden rounded-xl px-2 py-2 text-left text-[11px] leading-tight transition sm:text-xs ${
                  stage === i ? "bg-white/8 text-neutral-100" : "text-neutral-500 hover:bg-white/5 hover:text-neutral-300"
                }`}
              >
                <span className="block font-semibold">{i + 1}</span>
                <span className="block">{s.title}</span>
                {stage === i && !paused && !reduced && (
                  <span
                    className="hero-progress absolute inset-x-0 bottom-0 h-0.5 bg-emerald-400"
                    style={{ animationDuration: `${STAGE_MS}ms` }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Scene */}
          <div className="relative aspect-square w-full bg-[#0b0f0e] sm:aspect-[4/3]">
            {/* Plan / 3D scene */}
            <div
              className={`absolute inset-0 flex items-start justify-center pt-[5%] transition-opacity duration-700 ${
                rendering ? "pointer-events-none opacity-0" : "opacity-100"
              }`}
              style={{ perspective: "1100px" }}
            >
              <div
                className="hero-floor relative"
                style={{
                  width: "62%",
                  aspectRatio: "4 / 3",
                  transform: is3d
                    ? "translateY(3%) rotateX(56deg) rotateZ(-34deg) translateZ(-20px)"
                    : "translateY(0) rotateX(0deg) rotateZ(0deg)",
                }}
              >
                {ROOMS.map((r) => {
                  const active = selecting && r.id === focus.id;
                  return (
                    // A div, not a <button>: Chromium flattens 3D transforms inside
                    // form controls, which would sink the CSS walls under the floor.
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Preview the ${r.name}`}
                      onClick={() => pickRoom(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          pickRoom(r.id);
                        }
                      }}
                      className="hero-room group absolute cursor-pointer text-left"
                      style={{
                        transformStyle: "preserve-3d",
                        left: `${r.x}%`,
                        top: `${r.y}%`,
                        width: `${r.w}%`,
                        height: `${r.h}%`,
                        background: active ? "rgba(95,224,176,0.16)" : r.tint,
                      }}
                    >
                      {/* Walls (CSS 3D). Height animates from 0 → up on stage 2. */}
                      {(["n", "s", "e", "w"] as const).map((side) => (
                        <span key={side} className={`hero-wall hero-wall-${side} ${is3d ? "hero-wall-up" : ""}`} />
                      ))}
                      {/* Openings */}
                      {r.openings?.map((o, i) => (
                        <span
                          key={i}
                          className="absolute rounded-sm"
                          style={{
                            background: o.kind === "window" ? "#38bdf8" : "#b45309",
                            ...(o.side === "n" || o.side === "s"
                              ? { left: `${o.at}%`, width: `${o.len}%`, height: 3, [o.side === "n" ? "top" : "bottom"]: -1 }
                              : { top: `${o.at}%`, height: `${o.len}%`, width: 3, [o.side === "w" ? "left" : "right"]: -1 }),
                          }}
                        />
                      ))}
                      {/* Furniture blocks in the Layout-lock legend colours */}
                      {r.furniture?.map((f, i) => (
                        <span
                          key={i}
                          className="hero-furniture absolute rounded-[3px]"
                          style={{
                            left: `${f.x}%`,
                            top: `${f.y}%`,
                            width: `${f.w}%`,
                            height: `${f.h}%`,
                            background: f.color,
                            opacity: is3d ? 0.95 : 0.55,
                            transform: is3d ? "translateZ(14px)" : "translateZ(0)",
                          }}
                        />
                      ))}
                      <span className="pointer-events-none absolute left-1 top-1 text-[9px] font-semibold uppercase tracking-wide text-[#4b5552] sm:text-[10px]">
                        {r.name}
                      </span>
                      <span className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-emerald-400/0 transition group-hover:ring-emerald-400/60" />
                    </div>
                  );
                })}

                {/* Selection box drawn on the plan (stage 3) */}
                {selecting && (
                  <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                    <rect
                      className="hero-dash"
                      x={`${focus.x - 1.5}%`}
                      y={`${focus.y - 1.5}%`}
                      width={`${focus.w + 3}%`}
                      height={`${focus.h + 3}%`}
                      rx="4"
                      fill="rgba(95,224,176,0.08)"
                      stroke="#5fe0b0"
                      strokeWidth="2"
                    />
                  </svg>
                )}

                {/* Upload pulse (stage 1) */}
                {stage === 0 && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="hero-pulse flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/50 bg-[#0b0f0e]/80 text-emerald-300">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Photoreal-style interior mock (stage 4) */}
            <div
              className={`absolute inset-0 transition-opacity duration-700 ${rendering ? "opacity-100" : "pointer-events-none opacity-0"}`}
              aria-hidden={!rendering}
            >
              <InteriorMock roomName={focus.name} key={focus.id} animate={rendering} />
            </div>

            {/* Caption */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0b0f0e] via-[#0b0f0e]/85 to-transparent p-4 pt-10">
              <p className="text-sm font-medium text-neutral-100">{STAGES[stage].title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{STAGES[stage].body}</p>
              {!rendering && (
                <p className="mt-1 text-[11px] text-emerald-400/80">
                  Tip: click any room to preview it
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Upload ---------- */}
      <div ref={uploaderRef} className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Start here</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <PlanUploader onPlanSelected={onPlanSelected} />
      </div>
    </section>
  );
}

/** A stylised eye-level interior, in pure CSS, standing in for the real render. */
function InteriorMock({ roomName, animate }: { roomName: string; animate: boolean }) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* back wall */}
      <div className="absolute inset-x-[18%] top-[14%] h-[52%] bg-[#d9d2c5]" />
      {/* side walls */}
      <div className="absolute left-0 top-0 h-full w-[18%] bg-gradient-to-r from-[#8f877a] to-[#b8b0a2]" style={{ clipPath: "polygon(0 0,100% 14%,100% 66%,0 100%)" }} />
      <div className="absolute right-0 top-0 h-full w-[18%] bg-gradient-to-l from-[#8f877a] to-[#b8b0a2]" style={{ clipPath: "polygon(100% 0,0 14%,0 66%,100% 100%)" }} />
      {/* ceiling */}
      <div className="absolute inset-x-0 top-0 h-[14%] bg-gradient-to-b from-[#f2ede4] to-[#e4ded3]" style={{ clipPath: "polygon(0 0,100% 0,82% 100%,18% 100%)" }} />
      {/* floor */}
      <div className="absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-t from-[#8c6a4a] to-[#b48c66]" style={{ clipPath: "polygon(18% 0,82% 0,100% 100%,0 100%)" }} />
      {/* window with daylight */}
      <div className="absolute right-[6%] top-[22%] h-[30%] w-[9%] rounded-sm bg-gradient-to-b from-[#bfe7ff] to-[#7dd3fc] shadow-[0_0_40px_10px_rgba(125,211,252,0.25)]" style={{ transform: "skewY(18deg)" }} />
      {/* wardrobe */}
      <div className="absolute left-[8%] top-[28%] h-[40%] w-[9%] rounded-sm bg-gradient-to-b from-[#6b4a32] to-[#4a3222] shadow-lg" style={{ transform: "skewY(-18deg)" }} />
      {/* bed */}
      <div className="absolute left-[34%] top-[46%] h-[22%] w-[32%] rounded-md bg-gradient-to-b from-[#f4f1ea] to-[#dcd6ca] shadow-[0_18px_30px_-10px_rgba(0,0,0,0.6)]" />
      <div className="absolute left-[34%] top-[40%] h-[10%] w-[32%] rounded-t-md bg-[#5b4634]" />
      <div className="absolute left-[38%] top-[44%] h-[7%] w-[10%] rounded bg-white/90" />
      <div className="absolute left-[52%] top-[44%] h-[7%] w-[10%] rounded bg-white/90" />
      {/* nightstand */}
      <div className="absolute left-[69%] top-[54%] h-[10%] w-[6%] rounded-sm bg-[#7a5a3e] shadow-md" />
      {/* rug */}
      <div className="absolute left-[30%] top-[70%] h-[10%] w-[40%] rounded-[50%] bg-[#c9b79a]/70" />
      {/* label + verified badge */}
      <div className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs text-neutral-100 backdrop-blur">
        {roomName} · eye-level render
      </div>
      <div
        className={`absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-emerald-950 shadow-lg ${
          animate ? "hero-pop" : "opacity-0"
        }`}
      >
        <Check dark /> Verified against plan
      </div>
    </div>
  );
}

function Check({ dark = false }: { dark?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={dark ? "shrink-0" : "mt-0.5 shrink-0 text-emerald-400"}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
