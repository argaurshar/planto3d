"use client";

// The whole app: upload a plan → read it once into an exact 3D room → shoot it
// (main door at eye level, behind the bed/sofa, corners, top) → edit it by
// typing or in the panels → optionally make any shot photoreal, or take the
// model to Blender. The RoomModel is the single source of truth: every view,
// shot, edit and export is built from it.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { RoomKind, RoomModel, Shot } from "@/lib/room/types";
import { roomShots } from "@/lib/room/shots";
import { SAMPLES } from "@/lib/room/samples";
import { applyOps, runCommand, sanitizeOps, type ApplyResult, type Op } from "@/lib/room/commands";
import { readingToRoom } from "@/lib/room/read";
import { autoFurnish, blankRoom } from "@/lib/room/furnish";
import { normalizeRoom } from "@/lib/room/place";
import { formatSize } from "@/lib/room/geometry";
import { itemLabel } from "@/lib/room/catalog";
import { cropPlan, loadPlanFile, loadPlanImage, savePlanImage, type PlanImage } from "@/lib/planFile";
import { placeOpening, refitPlan, resizeRoom } from "@/lib/room/planFit";
import { aiCommand, aiLabel, aiReadPlan, aiRealistic, currentProvider, IS_STATIC } from "@/lib/ai/client";
import Viewport3D, { type Viewport3DHandle } from "./components/studio/Viewport3D";
import ShotBar from "./components/studio/ShotBar";
import CommandBar, { type LogLine } from "./components/studio/CommandBar";
import ElementsPanel from "./components/studio/ElementsPanel";
import RoomPanel from "./components/studio/RoomPanel";
import ShotGallery, { type ShotRecord } from "./components/studio/ShotGallery";
import { getRenderServer, RENDER_SERVER_EVENT, renderInBlender, type Quality } from "@/lib/room/renderServer";
import StartScreen from "./components/StartScreen";
import PlanStep from "./components/PlanStep";
import PlanCheck from "./components/studio/PlanCheck";

// ------------------------------------------------------------ model + history

interface ModelState {
  room: RoomModel | null;
  past: RoomModel[];
  future: RoomModel[];
  version: number;
  selectedId: string | null;
  lastId: string | null;
}

type ModelAction =
  | { type: "load"; room: RoomModel }
  | { type: "edit"; room: RoomModel; select?: string | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "select"; id: string | null }
  | { type: "clear" };

const HISTORY = 80;

function validSelection(room: RoomModel, id: string | null): string | null {
  return id && room.items.some((i) => i.id === id) ? id : null;
}

function modelReducer(s: ModelState, a: ModelAction): ModelState {
  switch (a.type) {
    case "load":
      return { room: a.room, past: [], future: [], version: s.version + 1, selectedId: null, lastId: null };
    case "edit": {
      if (!s.room) return s;
      const sel = a.select === undefined ? validSelection(a.room, s.selectedId) : validSelection(a.room, a.select);
      return { room: a.room, past: [...s.past, s.room].slice(-HISTORY), future: [], version: s.version + 1, selectedId: sel, lastId: sel ?? s.lastId };
    }
    case "undo": {
      if (!s.room || !s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, room: prev, past: s.past.slice(0, -1), future: [s.room, ...s.future], version: s.version + 1, selectedId: validSelection(prev, s.selectedId) };
    }
    case "redo": {
      if (!s.room || !s.future.length) return s;
      const next = s.future[0];
      return { ...s, room: next, past: [...s.past, s.room], future: s.future.slice(1), version: s.version + 1, selectedId: validSelection(next, s.selectedId) };
    }
    case "select":
      return { ...s, selectedId: a.id, lastId: a.id ?? s.lastId };
    case "clear":
      return { room: null, past: [], future: [], version: s.version + 1, selectedId: null, lastId: null };
  }
}

const SAVE_KEY = "planto3d_room_v1";

function loadSaved(): RoomModel | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const r = (JSON.parse(raw) as { room?: RoomModel }).room;
    return r && r.version === 1 && typeof r.width === "number" && Array.isArray(r.items) && Array.isArray(r.openings) ? r : null;
  } catch {
    return null;
  }
}

function suggestionsFor(room: RoomModel, selectedId: string | null): string[] {
  const has = (t: string) => room.items.some((i) => i.type === t);
  const s: string[] = [];
  if (selectedId) s.push("Change that design", "Delete that");
  if (room.kind === "bedroom" || room.kind === "kids" || has("bed")) {
    s.push(has("bedBack") ? "Change bed back design" : "Add bed back");
    if (has("bed")) s.push("Change bed design");
    s.push(has("nightstand") ? "Change side table design" : "Add side tables");
    if (has("bed")) s.push("Take shot from bed back");
  } else if (has("sofa")) {
    s.push("Change sofa design", "Make the sofa emerald velvet", "Take shot from sofa back");
  }
  s.push("Next shot");
  return s.slice(0, 7);
}

let logSeq = 0;

// ------------------------------------------------------------------ component

export default function Studio() {
  const [phase, setPhase] = useState<"start" | "plan" | "studio">("start");
  const [plan, setPlan] = useState<PlanImage | null>(null);
  const planFile = useRef<File | null>(null);
  const [m, dispatch] = useReducer(modelReducer, { room: null, past: [], future: [], version: 0, selectedId: null, lastId: null });
  const [shots, setShots] = useState<ShotRecord[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clay, setClay] = useState(false);
  const [viewShot, setViewShot] = useState<Shot | null>(null);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [tab, setTab] = useState<"elements" | "room" | "plan">("elements");
  const [view, setView] = useState<"3d" | "plan">("3d");
  const [pending, setPending] = useState<{ shot: Shot; replace?: string; nonce: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saved, setSaved] = useState<RoomModel | null>(null);
  const [, setKeyTick] = useState(0);
  const [blenderReady, setBlenderReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const vp = useRef<Viewport3DHandle>(null);

  const room = m.room;
  const presets = useMemo(() => (room ? roomShots(room) : []), [room]);
  const aiReady = Boolean(currentProvider()) || !IS_STATIC;
  const aiName = aiLabel();

  const say = useCallback((who: LogLine["who"], text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [...l.slice(-40), { id: ++logSeq, who, text, tone }]);
  }, []);

  // Saved room ("continue") and key changes.
  useEffect(() => {
    setSaved(loadSaved());
    const onKey = () => setKeyTick((t) => t + 1);
    const onServer = () => setBlenderReady(Boolean(getRenderServer()));
    onServer();
    window.addEventListener("planto3d-key", onKey);
    window.addEventListener(RENDER_SERVER_EVENT, onServer);
    return () => {
      window.removeEventListener("planto3d-key", onKey);
      window.removeEventListener(RENDER_SERVER_EVENT, onServer);
    };
  }, []);

  useEffect(() => {
    if (!room) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify({ room }));
      } catch {
        /* storage full or blocked: the session still works */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [room]);

  // A preset shot follows the model: move the bed and the "bed back view" moves with it.
  useEffect(() => {
    if (!activeShotId) return;
    const s = presets.find((p) => p.id === activeShotId);
    if (s) setViewShot(s);
  }, [presets, activeShotId]);

  // ---------------------------------------------------------------- shots

  const takeShot = useCallback((shot: Shot, replace?: string) => {
    const preset = !shot.id.startsWith("custom");
    setActiveShotId(preset ? shot.id : null);
    if (preset) setViewShot(shot);
    setPending({ shot, replace, nonce: Date.now() });
  }, []);

  useEffect(() => {
    if (!pending || !room) return;
    let cancelled = false;
    setCapturing(true);
    const id = requestAnimationFrame(async () => {
      try {
        const raw = await vp.current!.capture(pending.shot);
        if (cancelled) return;
        const rec: ShotRecord = {
          id: pending.replace ?? `shot-${pending.nonce}`,
          label: pending.shot.label,
          shot: pending.shot,
          raw,
          version: m.version,
          room,
          createdAt: Date.now(),
        };
        setShots((s) => (pending.replace ? s.map((x) => (x.id === pending.replace ? rec : x)) : [...s, rec]));
      } catch (e) {
        if (!cancelled) say("app", e instanceof Error ? e.message : "Could not render the shot.", "err");
      } finally {
        if (!cancelled) {
          setCapturing(false);
          setPending(null);
        }
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      setCapturing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const resolveShot = useCallback(
    (r: RoomModel, key: string): Shot | null => {
      const list = roomShots(r);
      if (key === "next") {
        const i = list.findIndex((s) => s.id === activeShotId);
        return list[(i + 1) % list.length] ?? null;
      }
      if (key === "corner") {
        const corners = list.filter((s) => s.id.startsWith("c-"));
        const i = corners.findIndex((s) => s.id === activeShotId);
        return corners[(i + 1) % Math.max(1, corners.length)] ?? null;
      }
      return list.find((s) => s.id === key) ?? null;
    },
    [activeShotId],
  );

  // ------------------------------------------------------------ open a room

  const enterStudio = useCallback(
    (r: RoomModel, notes: string[] = []) => {
      dispatch({ type: "load", room: r });
      setShots([]);
      setLog([]);
      setTab("elements");
      setView("3d");
      setPhase("studio");
      setError(null);
      say("app", `${r.name}: ${formatSize(r.width, r.depth)}, ceiling ${r.height.toFixed(2)} m, ${r.items.length} pieces, ${r.openings.length} doors/windows.`, "ok");
      for (const n of notes) say("app", n, "info");
      const entry = roomShots(r)[0];
      if (entry) {
        say("app", "Here is the raw shot from the main door at eye level. Pick another shot above, or type a change below.", "ok");
        takeShot(entry);
      }
    },
    [say, takeShot],
  );

  const onFile = useCallback(async (file: File) => {
    setError(null);
    setBusy("Opening the plan…");
    try {
      const p = await loadPlanFile(file);
      planFile.current = file;
      setPlan(p);
      setPhase("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be opened.");
    } finally {
      setBusy(null);
    }
  }, []);

  const onPage = useCallback(async (page: number) => {
    if (!planFile.current) return;
    setBusy("Opening page…");
    try {
      setPlan(await loadPlanFile(planFile.current, page));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That page could not be opened.");
    } finally {
      setBusy(null);
    }
  }, []);

  const onRead = useCallback(
    async ({ kind, hint, crop }: { kind: RoomKind | null; hint: string; crop: { x: number; y: number; w: number; h: number } | null }) => {
      if (!plan) return;
      setError(null);
      setBusy(`Reading the plan with ${aiLabel()}… walls, printed dimensions, doors, windows, furniture`);
      try {
        const image = crop ? await cropPlan(plan, crop) : plan;
        const reading = await aiReadPlan(image.src, [kind ? `It is a ${kind}.` : "", hint].filter(Boolean).join(" "));
        const planRef = `p${Date.now().toString(36)}`;
        const { room: r, warnings } = readingToRoom(reading, { width: image.width, height: image.height }, { kind: kind ?? undefined, planRef });
        setPlan(image);
        void savePlanImage(planRef, image);
        const notes = [...warnings];
        if (!r.items.some((i) => i.type !== "rug")) notes.push("No furniture is drawn on this plan — press “Furnish it for me”, or add pieces by typing (e.g. “add a bed”).");
        enterStudio(r, notes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The plan could not be read.");
      } finally {
        setBusy(null);
      }
    },
    [plan, enterStudio],
  );

  // ----------------------------------------------------------------- edits

  const commit = useCallback(
    (res: ApplyResult, aiReply?: string) => {
      if (res.changed) dispatch({ type: "edit", room: res.room, select: res.select ?? undefined });
      if (aiReply) say("app", aiReply, "ai");
      for (const t of res.messages) say("app", t, "ok");
      for (const t of res.errors) say("app", t, "err");
      if (res.shot) {
        const s = resolveShot(res.room, res.shot);
        if (s) {
          setView("3d");
          takeShot(s);
        }
        else say("app", "That shot is not available for this room (it needs a main piece such as a bed or sofa).", "err");
      }
      if (!res.changed && !res.shot && !res.messages.length && !res.errors.length && !aiReply) say("app", "Nothing to change.", "info");
    },
    [resolveShot, say, takeShot],
  );

  const applyOpsNow = useCallback((ops: Op[]) => room && commit(applyOps(room, ops)), [room, commit]);

  const runText = useCallback(
    async (text: string) => {
      if (!room) return;
      say("you", text);
      if (/^\s*undo\s*$/i.test(text)) {
        say("app", m.past.length ? "Undone." : "Nothing to undo.", m.past.length ? "ok" : "info");
        return dispatch({ type: "undo" });
      }
      if (/^\s*redo\s*$/i.test(text)) {
        say("app", m.future.length ? "Redone." : "Nothing to redo.", m.future.length ? "ok" : "info");
        return dispatch({ type: "redo" });
      }
      const local = runCommand(room, text, { selectedId: m.selectedId, lastId: m.lastId });
      if (local.understood) return commit(local);
      if (!(Boolean(currentProvider()) || !IS_STATIC)) {
        say("app", `I didn’t catch “${local.unknown ?? text}”. Try “add bed back”, “change side table design”, “make the sofa emerald velvet”, “move the bed 30 cm left”, “delete that” — or add an AI key below for free-form requests.`, "err");
        return;
      }
      setBusy(`Asking ${aiLabel()}…`);
      try {
        const out = await aiCommand(room, text, m.selectedId);
        const ops = sanitizeOps(room, out.ops);
        if (!ops.length) say("app", out.reply || "The AI found nothing to change.", "info");
        else commit(applyOps(room, ops), out.reply);
      } catch (e) {
        say("app", e instanceof Error ? e.message : "The AI request failed.", "err");
      } finally {
        setBusy(null);
      }
    },
    [room, m.selectedId, m.lastId, m.past.length, m.future.length, commit, say],
  );

  const onRoomPanel = useCallback(
    (next: RoomModel) => {
      if (!room) return;
      // A new size goes through resizeRoom: flush pieces stay flush, and a room read from a plan keeps its place on it.
      const resized = next.width !== room.width || next.depth !== room.depth;
      dispatch({ type: "edit", room: resized ? resizeRoom({ ...next, width: room.width, depth: room.depth }, next.width, next.depth) : normalizeRoom(next) });
    },
    [room],
  );

  // ------------------------------------------------------------ plan check

  const onRefit = useCallback(
    (box: [number, number, number, number]) => {
      if (!room) return;
      const r = refitPlan(room, box);
      dispatch({ type: "edit", room: r });
      say("app", `Walls re-fitted to your plan: ${formatSize(r.width, r.depth)}. Doors, windows and pieces kept their place on the drawing.`, "ok");
    },
    [room, say],
  );

  const onFitPlan = useCallback(
    (box: [number, number, number, number]) => {
      if (!room || !plan) return;
      const ref = `p${Date.now().toString(36)}`;
      void savePlanImage(ref, plan);
      dispatch({ type: "edit", room: { ...room, plan: { ref, imageW: plan.width, imageH: plan.height, box } } });
      say("app", "The model is now placed on your plan. Drag pieces, doors and windows to where the drawing has them.", "ok");
    },
    [room, plan, say],
  );

  const onFurnish = useCallback(() => {
    if (!room) return;
    const r = autoFurnish(room);
    if (!r.added) return say("app", "There is no free space for a standard layout — add pieces one by one instead.", "info");
    dispatch({ type: "edit", room: r.room });
    say("app", `Furnished with a standard ${room.kind} layout: ${r.added} pieces${r.skipped.length ? ` (no room for ${r.skipped.map(itemLabel).join(", ")})` : ""}. Change anything by typing.`, "ok");
  }, [room, say]);

  const onRealistic = useCallback(
    async (id: string, extra: string) => {
      const rec = shots.find((s) => s.id === id);
      if (!rec) return;
      setShots((s) => s.map((x) => (x.id === id ? { ...x, realBusy: true, realError: undefined } : x)));
      try {
        const real = await aiRealistic(rec.room, rec.shot, rec.raw, extra);
        setShots((s) => s.map((x) => (x.id === id ? { ...x, real, realBusy: false } : x)));
      } catch (e) {
        setShots((s) => s.map((x) => (x.id === id ? { ...x, realBusy: false, realError: e instanceof Error ? e.message : "The realistic render failed." } : x)));
      }
    },
    [shots],
  );

  // Real Blender Cycles on the render server, from the shot's exact camera.
  const onBlender = useCallback(
    async (id: string, quality: Quality) => {
      const rec = shots.find((s) => s.id === id);
      if (!rec) return;
      const patch = (p: Partial<ShotRecord>) => setShots((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)));
      patch({ cyclesStatus: "Preparing…", cyclesError: undefined });
      try {
        const cycles = await renderInBlender(rec.room, rec.shot, quality, (t) => patch({ cyclesStatus: t }));
        patch({ cycles, cyclesQuality: quality, cyclesStatus: undefined });
      } catch (e) {
        patch({ cyclesStatus: undefined, cyclesError: e instanceof Error ? e.message : "The Blender render failed." });
      }
    },
    [shots],
  );

  const onRetake = useCallback(
    (id: string) => {
      const rec = shots.find((s) => s.id === id);
      if (!rec || !room) return;
      const preset = roomShots(room).find((p) => p.id === rec.shot.id);
      takeShot(preset ?? rec.shot, id);
    },
    [shots, room, takeShot],
  );

  const onExport = useCallback(async () => {
    if (!room) return;
    setExporting(true);
    try {
      const { downloadBlenderPackage } = await import("@/lib/room/blender");
      await downloadBlenderPackage(room);
      say("app", "Downloaded the Blender package: open Blender → Scripting → Open render_in_blender.py → Run Script (or import room.glb directly).", "ok");
    } catch (e) {
      say("app", e instanceof Error ? e.message : "Export failed.", "err");
    } finally {
      setExporting(false);
    }
  }, [room, say]);

  // Keyboard: Delete removes the selection, Ctrl/Cmd+Z undoes, Esc deselects.
  useEffect(() => {
    if (phase !== "studio") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && m.selectedId) {
        e.preventDefault();
        applyOpsNow([{ op: "remove", ids: [m.selectedId] }]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Escape") dispatch({ type: "select", id: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, m.selectedId, applyOpsNow]);

  // ------------------------------------------------------------------ views

  if (phase === "start" || (phase === "studio" && !room)) {
    return (
      <StartScreen
        onFile={onFile}
        onSample={(id) => {
          const s = SAMPLES.find((x) => x.id === id);
          if (s) {
            setPlan(null);
            enterStudio(structuredClone(s.room));
          }
        }}
        onBlank={(kind, w, d) => {
          setPlan(null);
          const r = autoFurnish(blankRoom(kind, w, d));
          enterStudio(r.room, [`Started from a ${formatSize(w, d)} room with one door and one window, furnished with a standard layout. Move the door and window in Room settings, and change anything by typing.`]);
        }}
        savedName={saved ? `${saved.name} (${formatSize(saved.width, saved.depth)})` : null}
        onContinue={() => {
          if (!saved) return;
          setPlan(saved.plan ? loadPlanImage(saved.plan.ref) : null);
          enterStudio(saved);
        }}
        error={error}
        busy={!!busy}
      />
    );
  }

  if (phase === "plan" && plan) {
    return (
      <PlanStep
        plan={plan}
        busy={busy}
        error={error}
        aiReady={aiReady}
        aiName={aiName}
        onRead={onRead}
        onPage={onPage}
        onManual={(kind) => {
          const r = blankRoom(kind, 3.66, 4.27);
          enterStudio(r, ["Started from a 12′×14′ room. Set the real size, doors and windows in Room settings, then press “Furnish it for me” or add pieces by typing."]);
          setTab("room");
        }}
        onBack={() => {
          setPlan(null);
          setPhase("start");
        }}
      />
    );
  }

  if (!room) return null;
  const selected = room.items.find((i) => i.id === m.selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{room.name}</h1>
          <p className="text-xs text-neutral-400">
            {formatSize(room.width, room.depth)} · ceiling {room.height.toFixed(2)} m ·{" "}
            {room.scaleSource === "printed" ? (
              <span className="text-emerald-300/90">true scale from the printed dimensions</span>
            ) : room.scaleSource === "estimated" ? (
              <span className="text-amber-300/90">scale estimated — check the size in Room</span>
            ) : (
              <span>size set by you</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setClay((c) => !c)} className="btn-outline min-h-0 px-3 py-1.5 text-xs" title="White clay model, to check the geometry">
            {clay ? "◐ Materials" : "◯ Clay"}
          </button>
          <button type="button" onClick={onExport} disabled={exporting} className="btn-outline min-h-0 px-3 py-1.5 text-xs">
            {exporting ? "Exporting…" : "⬇ Blender"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase("start");
              setSaved(room);
              dispatch({ type: "clear" });
              setShots([]);
            }}
            className="btn-ghost text-xs"
          >
            New plan
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          {plan && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1 rounded-full bg-white/5 p-1 text-xs">
                {(["3d", "plan"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setView(v)} className={`rounded-full px-3 py-1 transition ${view === v ? "bg-emerald-400/20 text-emerald-100" : "text-neutral-400 hover:text-white"}`}>
                    {v === "3d" ? "3D model" : "Plan check"}
                  </button>
                ))}
              </div>
              {view === "plan" && <span className="text-[11px] text-neutral-500">Every correction here is an edit: undo works.</span>}
            </div>
          )}
          <div className="relative">
            <Viewport3D
              ref={vp}
              room={room}
              clay={clay}
              shot={viewShot}
              selectedId={m.selectedId}
              onSelect={(id) => dispatch({ type: "select", id })}
              onMove={(id, x, z) => applyOpsNow([{ op: "update", ids: [id], x, z }])}
              onFreeCamera={() => setActiveShotId(null)}
            />
            {view === "plan" && plan && (
              <PlanCheck
                room={room}
                image={plan}
                selectedId={m.selectedId}
                onSelect={(id) => dispatch({ type: "select", id })}
                onMoveItem={(id, x, z) => applyOpsNow([{ op: "update", ids: [id], x, z }])}
                onMoveOpening={(id, x, z) => dispatch({ type: "edit", room: placeOpening(room, id, x, z) })}
                onRefit={onRefit}
                onFit={onFitPlan}
              />
            )}
          </div>
          <ShotBar
            shots={presets}
            activeId={activeShotId}
            busy={capturing}
            onPick={(s) => {
              setActiveShotId(s.id);
              setViewShot(s);
              setView("3d");
            }}
            onCapture={() => {
              const s = activeShotId ? presets.find((p) => p.id === activeShotId) : vp.current?.currentShot();
              if (s) takeShot(s);
            }}
          />
          <CommandBar
            suggestions={suggestionsFor(room, m.selectedId)}
            log={log}
            busy={busy}
            canUndo={m.past.length > 0}
            canRedo={m.future.length > 0}
            onRun={runText}
            onUndo={() => dispatch({ type: "undo" })}
            onRedo={() => dispatch({ type: "redo" })}
          />
        </div>

        <aside className="card h-fit space-y-4 p-4">
          <div className="flex gap-1 rounded-full bg-white/5 p-1 text-xs">
            {(["elements", "room", "plan"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`flex-1 rounded-full px-3 py-1.5 capitalize transition ${tab === t ? "bg-emerald-400/20 text-emerald-100" : "text-neutral-400 hover:text-white"}`}>
                {t}
                {t === "elements" && selected ? " •" : ""}
              </button>
            ))}
          </div>
          {tab === "elements" && <ElementsPanel room={room} selectedId={m.selectedId} onSelect={(id) => dispatch({ type: "select", id })} onApply={applyOpsNow} onFurnish={onFurnish} />}
          {tab === "room" && <RoomPanel room={room} onChange={onRoomPanel} />}
          {tab === "plan" && (
            <div className="space-y-3 text-xs text-neutral-400">
              {plan ? (
                <>
                  <button type="button" onClick={() => setView("plan")} className="block w-full overflow-hidden rounded-xl border border-white/10 bg-white" title="Open the plan check">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={plan.src} alt="Your plan" className="w-full" />
                  </button>
                  <button type="button" onClick={() => setView("plan")} className="btn-outline w-full min-h-0 px-3 py-1.5 text-xs">
                    {room.plan ? "Check the model on the plan" : "Place the model on the plan"}
                  </button>
                  <p className="leading-relaxed">
                    {room.plan
                      ? "Plan check draws the model over your drawing: the dashed outline is the walls, green boxes are furniture (the heavy edge is the front), violet is wall-hung, orange is a door and blue a window. Drag anything that is off, or drag the outline’s handles onto the drawing’s inner wall lines."
                      : "This room was set up by hand. Open the plan check and drag a box over the room’s inner wall lines, then drag pieces, doors and windows to where the drawing has them."}
                  </p>
                </>
              ) : room.plan ? (
                <p>The plan image for this room is not stored in this browser any more. Upload the plan again to check the model against it.</p>
              ) : (
                <p>This room was not read from a plan.</p>
              )}
              <p className="leading-relaxed">
                You can also fix things in Elements or Room, or type them (“move the wardrobe to the right wall”), and compare with the{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    const t = presets.find((p) => p.id === "top");
                    if (t) {
                      setActiveShotId("top");
                      setViewShot(t);
                      setView("3d");
                    }
                  }}
                >
                  top view
                </button>
                .
              </p>
            </div>
          )}
        </aside>
      </div>

      <ShotGallery
        shots={shots}
        version={m.version}
        aiReady={aiReady}
        aiName={aiName}
        blenderReady={blenderReady}
        onRealistic={onRealistic}
        onBlender={onBlender}
        onRemove={(id) => setShots((s) => s.filter((x) => x.id !== id))}
        onRetake={onRetake}
      />
    </div>
  );
}
