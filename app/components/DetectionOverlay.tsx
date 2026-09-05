"use client";

import { cameraSpot, isOpeningLabel, type SpatialBox } from "@/lib/spatial";

interface Props {
  cropDataUrl: string;
  /** Detected boxes in Gemini's 0-1000 coords ([ymin, xmin, ymax, xmax]). */
  boxes: SpatialBox[];
  alt?: string;
}

/**
 * The plan crop with the detected boxes drawn over it, plus a marker for the
 * viewpoint the render is taken from. This is the evidence the whole layout
 * lock rests on: if a box is wrong here, the clay model and the render will
 * be wrong too, and the fix is detection, not rendering.
 */
export default function DetectionOverlay({ cropDataUrl, boxes, alt }: Props) {
  const spot = boxes.length ? cameraSpot(boxes) : null;
  // Where the eye stands, in the same 0-1000 space, hugging its wall, with the
  // arrow pointing into the room.
  const eye = spot
    ? spot.wall === "near"
      ? { x: spot.along, y: 985, dx: 0, dy: -1 }
      : spot.wall === "far"
        ? { x: spot.along, y: 15, dx: 0, dy: 1 }
        : spot.wall === "left"
          ? { x: 15, y: spot.along, dx: 1, dy: 0 }
          : { x: 985, y: spot.along, dx: -1, dy: 0 }
    : null;

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cropDataUrl} alt={alt ?? "Selected room crop from the plan"} className="block w-full" />
      {boxes.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {boxes.map((b, i) => {
            const [ymin, xmin, ymax, xmax] = b.box_2d;
            const opening = isOpeningLabel(b.label);
            const stroke = opening ? "#38bdf8" : "#f59e0b";
            return (
              <g key={i}>
                <rect
                  x={xmin}
                  y={ymin}
                  width={Math.max(1, xmax - xmin)}
                  height={Math.max(1, ymax - ymin)}
                  fill={stroke}
                  fillOpacity={0.12}
                  stroke={stroke}
                  strokeWidth={6}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={xmin > 650 ? xmax - 10 : xmin + 10}
                  y={Math.min(985, ymin + 42)}
                  textAnchor={xmin > 650 ? "end" : "start"}
                  fill={stroke}
                  fontSize={40}
                  fontWeight={600}
                  style={{ paintOrder: "stroke", stroke: "#0a0a0a", strokeWidth: 8 }}
                >
                  {b.label}
                </text>
              </g>
            );
          })}
          {eye && (
            <g>
              <circle cx={eye.x} cy={eye.y} r={16} fill="#34d399" stroke="#0a0a0a" strokeWidth={4} />
              <line
                x1={eye.x}
                y1={eye.y}
                x2={eye.x + eye.dx * 110}
                y2={eye.y + eye.dy * 110}
                stroke="#34d399"
                strokeWidth={8}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={eye.x + eye.dx * 130 + (eye.dx === 0 ? 24 : 0)}
                y={eye.y + eye.dy * 130 + (eye.dy === 0 ? 14 : 0)}
                fill="#34d399"
                fontSize={38}
                fontWeight={600}
                style={{ paintOrder: "stroke", stroke: "#0a0a0a", strokeWidth: 8 }}
              >
                camera
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
