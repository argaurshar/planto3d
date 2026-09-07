"use client";

import { useEffect, useRef, useState } from "react";
import { cameraSpot, isHelperLabel, isOpeningLabel, type SpatialBox } from "@/lib/spatial";

interface Props {
  cropDataUrl: string;
  /** Detected boxes in Gemini's 0-1000 coords ([ymin, xmin, ymax, xmax]). */
  boxes: SpatialBox[];
  alt?: string;
  /**
   * When given, the boxes are editable: drag to move, corner handles to
   * resize, Delete to remove, relabel, or draw a missing item. Every change
   * is reported as a full new list.
   */
  onChange?: (boxes: SpatialBox[]) => void;
}

type Box4 = [number, number, number, number];
type Corner = "nw" | "ne" | "sw" | "se";
type Drag =
  | { mode: "move"; index: number; start: { x: number; y: number }; box: Box4 }
  | { mode: "resize"; index: number; corner: Corner; box: Box4 }
  | { mode: "draw"; start: { x: number; y: number }; box: Box4 };

const MIN_SIZE = 20; // 0-1000 units
const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

/**
 * The plan crop with the detected boxes drawn over it, plus a marker for the
 * viewpoint the render is taken from. This is the evidence the whole layout
 * lock rests on: if a box is wrong here, the clay model and the render will
 * be wrong too — so, where `onChange` is provided, the user can fix it here,
 * for free, instead of paying for a render that inherits the mistake.
 */
export default function DetectionOverlay({ cropDataUrl, boxes, alt, onChange }: Props) {
  const editable = Boolean(onChange);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<SpatialBox[] | null>(null);
  const [labelText, setLabelText] = useState("");

  const shown = draft ?? boxes;
  const items = shown.filter((b) => !isHelperLabel(b.label));
  const spot = items.length ? cameraSpot(shown) : null;

  useEffect(() => {
    if (selected !== null && selected >= boxes.length) setSelected(null);
  }, [boxes.length, selected]);
  useEffect(() => {
    setLabelText(selected !== null && boxes[selected] ? boxes[selected].label : "");
  }, [selected, boxes]);

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

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 1000),
      y: clamp(((e.clientY - r.top) / r.height) * 1000),
    };
  };
  const commit = (next: SpatialBox[]) => {
    setDraft(null);
    onChange?.(next);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (!editable) return;
    const p = toLocal(e);
    if (adding) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ mode: "draw", start: p, box: [p.y, p.x, p.y, p.x] });
      setDraft([...boxes, { label: "table", box_2d: [p.y, p.x, p.y, p.x] }]);
    } else {
      setSelected(null);
    }
  };
  const onBoxDown = (e: React.PointerEvent, index: number) => {
    if (!editable || adding) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setSelected(index);
    setDrag({ mode: "move", index, start: toLocal(e), box: [...boxes[index].box_2d] as Box4 });
  };
  const onHandleDown = (e: React.PointerEvent, index: number, corner: Corner) => {
    if (!editable) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setSelected(index);
    setDrag({ mode: "resize", index, corner, box: [...boxes[index].box_2d] as Box4 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toLocal(e);
    const next = [...(draft ?? boxes)];
    if (drag.mode === "move") {
      const [y0, x0, y1, x1] = drag.box;
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const w = x1 - x0;
      const h = y1 - y0;
      const nx = Math.max(0, Math.min(1000 - w, x0 + dx));
      const ny = Math.max(0, Math.min(1000 - h, y0 + dy));
      next[drag.index] = { ...next[drag.index], box_2d: [clamp(ny), clamp(nx), clamp(ny + h), clamp(nx + w)] };
    } else if (drag.mode === "resize") {
      let [y0, x0, y1, x1] = drag.box;
      if (drag.corner.includes("n")) y0 = Math.min(p.y, y1 - MIN_SIZE);
      if (drag.corner.includes("s")) y1 = Math.max(p.y, y0 + MIN_SIZE);
      if (drag.corner.includes("w")) x0 = Math.min(p.x, x1 - MIN_SIZE);
      if (drag.corner.includes("e")) x1 = Math.max(p.x, x0 + MIN_SIZE);
      next[drag.index] = { ...next[drag.index], box_2d: [clamp(y0), clamp(x0), clamp(y1), clamp(x1)] };
    } else {
      const y0 = Math.min(drag.start.y, p.y);
      const y1 = Math.max(drag.start.y, p.y);
      const x0 = Math.min(drag.start.x, p.x);
      const x1 = Math.max(drag.start.x, p.x);
      next[next.length - 1] = { ...next[next.length - 1], box_2d: [y0, x0, y1, x1] };
    }
    setDraft(next);
  };
  const onUp = () => {
    if (!drag) return;
    const next = draft ?? boxes;
    if (drag.mode === "draw") {
      const b = next[next.length - 1].box_2d;
      const tooSmall = b[2] - b[0] < MIN_SIZE || b[3] - b[1] < MIN_SIZE;
      setAdding(false);
      setDrag(null);
      if (tooSmall) {
        setDraft(null);
        return;
      }
      setSelected(next.length - 1);
      commit(next);
      return;
    }
    setDrag(null);
    commit(next);
  };
  const remove = () => {
    if (selected === null) return;
    const next = boxes.filter((_, i) => i !== selected);
    setSelected(null);
    commit(next);
  };
  const relabel = () => {
    if (selected === null) return;
    const label = labelText.trim().toLowerCase();
    if (!label || label === boxes[selected].label) return;
    commit(boxes.map((b, i) => (i === selected ? { ...b, label } : b)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!editable) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
      e.preventDefault();
      remove();
    }
    if (e.key === "Escape") {
      setSelected(null);
      setAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      <div
        className={`relative ${editable ? "select-none" : ""}`}
        tabIndex={editable ? 0 : undefined}
        onKeyDown={onKey}
        style={{ cursor: adding ? "crosshair" : undefined }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cropDataUrl} alt={alt ?? "Selected room crop from the plan"} className="block w-full" draggable={false} />
        <svg
          ref={svgRef}
          className={`absolute inset-0 h-full w-full ${editable ? "" : "pointer-events-none"}`}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          aria-hidden={!editable}
          onPointerDown={onBackgroundDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {shown.map((b, i) => {
            const [ymin, xmin, ymax, xmax] = b.box_2d;
            const opening = isOpeningLabel(b.label);
            // Pillows are an orientation cue for the bed, not an object.
            const stroke = opening ? "#38bdf8" : isHelperLabel(b.label) ? "#e5e7eb" : "#f59e0b";
            const isSel = editable && selected === i;
            return (
              <g key={i}>
                <rect
                  x={xmin}
                  y={ymin}
                  width={Math.max(1, xmax - xmin)}
                  height={Math.max(1, ymax - ymin)}
                  fill={stroke}
                  fillOpacity={isSel ? 0.22 : 0.12}
                  stroke={isSel ? "#ffffff" : stroke}
                  strokeWidth={isSel ? 8 : 6}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: editable && !adding ? "move" : undefined }}
                  onPointerDown={(e) => onBoxDown(e, i)}
                />
                <text
                  x={xmin > 650 ? xmax - 10 : xmin + 10}
                  y={Math.min(985, ymin + 42)}
                  textAnchor={xmin > 650 ? "end" : "start"}
                  fill={stroke}
                  fontSize={40}
                  fontWeight={600}
                  style={{ paintOrder: "stroke", stroke: "#0a0a0a", strokeWidth: 8, pointerEvents: "none" }}
                >
                  {b.label}
                </text>
                {isSel &&
                  (
                    [
                      ["nw", xmin, ymin],
                      ["ne", xmax, ymin],
                      ["sw", xmin, ymax],
                      ["se", xmax, ymax],
                    ] as Array<[Corner, number, number]>
                  ).map(([corner, cx, cy]) => (
                    <circle
                      key={corner}
                      cx={cx}
                      cy={cy}
                      r={14}
                      fill="#ffffff"
                      stroke="#0a0a0a"
                      strokeWidth={3}
                      style={{ cursor: `${corner}-resize` }}
                      onPointerDown={(e) => onHandleDown(e, i, corner)}
                    />
                  ))}
              </g>
            );
          })}
          {eye && (
            <g style={{ pointerEvents: "none" }}>
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
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setAdding((a) => !a);
              setSelected(null);
            }}
            className={`chip ${adding ? "chip-active" : ""}`}
          >
            {adding ? "Drag on the plan to draw…" : "+ Add box"}
          </button>
          {selected !== null && boxes[selected] && (
            <>
              <input
                value={labelText}
                onChange={(e) => setLabelText(e.target.value)}
                onBlur={relabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                aria-label="Label of the selected box"
                className="w-32 rounded-md border border-white/10 bg-neutral-950/60 px-2 py-1 text-neutral-100 outline-none focus:border-emerald-500/70"
              />
              <button type="button" onClick={remove} className="chip text-red-300">
                Delete
              </button>
            </>
          )}
          {selected === null && !adding && (
            <span className="text-neutral-500">Click a box to move, resize, relabel or delete it.</span>
          )}
        </div>
      )}
    </div>
  );
}
