"use client";

import { useReducer, useRef } from "react";
import Hero from "./components/Hero";
import StepBar from "./components/StepBar";
import OverviewView from "./components/OverviewView";
import RoomSelector from "./components/RoomSelector";
import RoomSetup from "./components/RoomSetup";
import RoomPrompt from "./components/RoomPrompt";
import RoomResult from "./components/RoomResult";
import { requestOverview, requestRoomPrompt, requestRoomRender } from "@/lib/api";
import { buildBlockoutMaps } from "@/lib/blockout";
import { summarizeLabels, describeLayout, type SpatialBox } from "@/lib/spatial";
import { cropToDataUrl, type Rect } from "@/lib/crop";
import { DEFAULT_BRIEF } from "@/lib/styles";
import type { DesignBrief, LayoutVerification, RenderEngine, RoomType } from "@/lib/types";

type Step = "upload" | "overview" | "select" | "roomSetup" | "roomPrompt" | "room";
type Stage = "idle" | "writing" | "rendering";

/** Whether the render is geometry-locked to a blockout, and why not if not. */
export type LayoutLock = {
  status: "none" | "locked" | "no-webgl" | "no-objects";
  count: number;
  /** Human summary of detected labels, e.g. "bed, 2 nightstands, window". */
  summary: string;
};

/** One render of the selected room, with its own layout check (if any). */
export type RoomVersion = {
  url: string;
  verification?: LayoutVerification;
  /** Which engine produced it. */
  engine?: RenderEngine;
};

interface State {
  step: Step;
  planDataUrl: string | null;
  brief: DesignBrief;
  overviewDataUrl: string | null;
  cropDataUrl: string | null;
  /** Pixel aspect (w/h) of the room crop, used to proportion the 3D blockout. */
  cropAspect: number;
  /** Eye-level 3D blockout of the room (PNG data URL) used to lock the render. */
  blockoutDataUrl: string | null;
  /** Depth map of the same view, fed to the reference engine alongside the clay. */
  depthDataUrl: string | null;
  /** Which kie.ai model turns the blockout into the photo. Kept across rooms. */
  renderEngine: RenderEngine;
  /** Status of the layout lock (detected object count + why it's on/off). */
  layoutLock: LayoutLock;
  /** Detected-layout description used to verify renders (from describeLayout). */
  layoutText: string;
  /** The detected boxes themselves, drawn over the crop so the lock is inspectable. */
  boxes: SpatialBox[];
  roomType: RoomType;
  /** Per-room style override (defaults to the brief's style). */
  roomStyleId: string;
  roomPrompt: string;
  /** Every render of this room, each carrying its own verification. */
  roomVersions: RoomVersion[];
  currentVersion: number;
  /** Increments on each room render to vary the prompt. */
  variation: number;
  /** Used by overview generation and room-result regeneration. */
  loading: boolean;
  /** Drives the Stage 3a/3b UI in RoomPrompt. */
  stage: Stage;
  error: string | null;
}

type Action =
  | { type: "SET_PLAN"; dataUrl: string }
  | { type: "SET_BRIEF"; patch: Partial<DesignBrief> }
  | { type: "LOAD_OVERVIEW" }
  | { type: "OVERVIEW_DONE"; dataUrl: string }
  | { type: "APPROVE" }
  | { type: "GO_OVERVIEW" }
  | { type: "SET_ROOM_TYPE"; value: RoomType }
  | { type: "SET_ROOM_STYLE"; styleId: string }
  | { type: "SET_ENGINE"; engine: RenderEngine }
  | { type: "BEGIN_SETUP"; dataUrl: string; aspect: number }
  | { type: "START_WRITE" }
  | {
      type: "PROMPT_DONE";
      prompt: string;
      blockout: string | null;
      depth: string | null;
      lock: LayoutLock;
      layout: string;
      boxes: SpatialBox[];
    }
  | { type: "REWRITE" }
  | { type: "EDIT_PROMPT"; value: string }
  | { type: "RENDER_START" }
  | { type: "REGEN_START" }
  | { type: "ROOM_DONE"; version: RoomVersion }
  | { type: "SET_VERSION"; index: number }
  | { type: "EDIT_PROMPT_STEP" }
  | { type: "PICK_ANOTHER" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

/**
 * Everything that belongs to ONE selected room. Spread into the state whenever
 * a room is (re)selected so a new field can't be forgotten in one reset path
 * and leak the previous room's value into the next.
 */
const FRESH_ROOM = {
  blockoutDataUrl: null,
  depthDataUrl: null,
  layoutLock: { status: "none", count: 0, summary: "" },
  layoutText: "",
  boxes: [],
  roomPrompt: "",
  roomVersions: [],
  currentVersion: 0,
  variation: 0,
} satisfies Partial<State>;

const initialState: State = {
  step: "upload",
  planDataUrl: null,
  brief: DEFAULT_BRIEF,
  overviewDataUrl: null,
  cropDataUrl: null,
  cropAspect: 1,
  ...FRESH_ROOM,
  roomType: "auto",
  roomStyleId: DEFAULT_BRIEF.styleId,
  renderEngine: "reference",
  loading: false,
  stage: "idle",
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_PLAN":
      return {
        ...initialState,
        brief: state.brief, // keep brief across re-uploads
        planDataUrl: action.dataUrl,
        step: "overview",
      };
    case "SET_BRIEF":
      return { ...state, brief: { ...state.brief, ...action.patch } };
    case "LOAD_OVERVIEW":
      return { ...state, loading: true, error: null };
    case "OVERVIEW_DONE":
      return { ...state, loading: false, overviewDataUrl: action.dataUrl };
    case "APPROVE":
      return { ...state, step: "select", error: null };
    case "GO_OVERVIEW":
      return { ...state, step: "overview", error: null };
    case "SET_ROOM_TYPE":
      return { ...state, roomType: action.value };
    case "SET_ROOM_STYLE":
      return { ...state, roomStyleId: action.styleId };
    case "SET_ENGINE":
      return { ...state, renderEngine: action.engine };
    case "BEGIN_SETUP":
      return {
        ...state,
        step: "roomSetup",
        cropDataUrl: action.dataUrl,
        cropAspect: action.aspect,
        ...FRESH_ROOM,
        roomStyleId: state.brief.styleId,
        stage: "idle",
        error: null,
      };
    case "START_WRITE":
      return { ...state, step: "roomPrompt", stage: "writing", error: null };
    case "PROMPT_DONE":
      return {
        ...state,
        stage: "idle",
        roomPrompt: action.prompt,
        blockoutDataUrl: action.blockout,
        depthDataUrl: action.depth,
        layoutLock: action.lock,
        layoutText: action.layout,
        boxes: action.boxes,
      };
    case "REWRITE":
      return { ...state, stage: "writing", error: null };
    case "EDIT_PROMPT":
      return { ...state, roomPrompt: action.value };
    case "RENDER_START":
      return { ...state, stage: "rendering", error: null };
    case "REGEN_START":
      return { ...state, loading: true, error: null };
    case "ROOM_DONE": {
      const roomVersions = [...state.roomVersions, action.version];
      return {
        ...state,
        step: "room",
        loading: false,
        stage: "idle",
        roomVersions,
        currentVersion: roomVersions.length - 1,
        variation: state.variation + 1,
      };
    }
    case "SET_VERSION":
      return { ...state, currentVersion: action.index };
    case "EDIT_PROMPT_STEP":
      return { ...state, step: "roomPrompt", loading: false, stage: "idle", error: null };
    case "PICK_ANOTHER":
      return {
        ...state,
        step: "select",
        cropDataUrl: null,
        ...FRESH_ROOM,
        loading: false,
        stage: "idle",
        error: null,
      };
    case "ERROR":
      return { ...state, loading: false, stage: "idle", error: action.message };
    case "RESET":
      return { ...initialState, brief: state.brief };
    default:
      return state;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export default function PlanToThreeD() {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Monotonic token to invalidate stale async results. Any navigation that
  // changes context (pick another room, edit prompt, reset, back) bumps it, so
  // an in-flight request that resolves afterwards is ignored instead of
  // corrupting state (e.g. appending a stale render to a reset history).
  const reqId = useRef(0);
  const nextReq = () => (reqId.current += 1);
  const isStale = (id: number) => reqId.current !== id;

  // The brief used for this room — global brief with the per-room style override.
  const effectiveBrief = (): DesignBrief => ({
    ...state.brief,
    styleId: state.roomStyleId,
  });

  async function generateOverview() {
    if (!state.planDataUrl) return;
    const id = nextReq();
    dispatch({ type: "LOAD_OVERVIEW" });
    try {
      const image = await requestOverview(state.planDataUrl, state.brief);
      if (isStale(id)) return;
      dispatch({ type: "OVERVIEW_DONE", dataUrl: image });
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // Write (or rewrite) the interior prompt for the current crop, and build the
  // eye-level 3D blockout from the detected boxes so the render can lock layout.
  async function writePrompt(crop: string, id: number) {
    try {
      const { prompt, boxes, roomSize } = await requestRoomPrompt(
        crop,
        effectiveBrief(),
        state.roomType,
        state.overviewDataUrl ?? undefined,
      );
      if (isStale(id)) return;
      // Best-effort: a null blockout (no boxes / no WebGL) falls back to text-to-image.
      let blockout: string | null = null;
      let depth: string | null = null;
      try {
        const maps = await buildBlockoutMaps(boxes, state.cropAspect, { roomSize });
        blockout = maps?.clay ?? null;
        depth = maps?.depth ?? null;
      } catch {
        blockout = null;
      }
      if (isStale(id)) return;
      const lock: LayoutLock = {
        count: boxes.length,
        status: boxes.length === 0 ? "no-objects" : blockout ? "locked" : "no-webgl",
        summary: summarizeLabels(boxes),
      };
      if (typeof console !== "undefined") {
        console.debug("[voxa] layout lock:", lock.status, "boxes:", boxes.length, "blockout:", Boolean(blockout));
      }
      dispatch({ type: "PROMPT_DONE", prompt, blockout, depth, lock, layout: describeLayout(boxes), boxes });
    } catch (err) {
      if (isStale(id)) return;
      // Leave the box editable so the user can still write a prompt by hand.
      dispatch({
        type: "PROMPT_DONE",
        prompt: "",
        blockout: null,
        depth: null,
        lock: { status: "none", count: 0, summary: "" },
        layout: "",
        boxes: [],
      });
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // Crop the selection from the 2D PLAN (the geometric source of truth — the
  // generated overview is only a style reference) and move to the setup table.
  // A top-down plan crop is what detection + the blockout assume: image
  // coordinates ARE floor coordinates there, unlike on the axonometric overview.
  async function selectRoom(rect: Rect) {
    if (!state.planDataUrl) return;
    const id = nextReq();
    let crop: string;
    try {
      crop = await cropToDataUrl(state.planDataUrl, rect);
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
      return;
    }
    if (isStale(id)) return;
    const aspect = rect.height > 0 ? rect.width / rect.height : 1;
    dispatch({ type: "BEGIN_SETUP", dataUrl: crop, aspect });
  }

  // After the user picks type/style, write the interior prompt.
  function confirmSetup() {
    if (!state.cropDataUrl) return;
    const id = nextReq();
    dispatch({ type: "START_WRITE" });
    void writePrompt(state.cropDataUrl, id);
  }

  function rewritePrompt() {
    if (!state.cropDataUrl) return;
    const id = nextReq();
    dispatch({ type: "REWRITE" });
    void writePrompt(state.cropDataUrl, id);
  }

  /** Render (first time) or regenerate — identical request, different start action. */
  async function runRender(start: "RENDER_START" | "REGEN_START") {
    if (!state.cropDataUrl) return;
    const id = nextReq();
    dispatch({ type: start });
    try {
      const { image, verification } = await requestRoomRender(
        state.roomPrompt,
        state.variation,
        effectiveBrief(),
        state.blockoutDataUrl ?? undefined,
        state.layoutText || undefined,
        { engine: state.renderEngine, depthDataUrl: state.depthDataUrl ?? undefined },
      );
      if (isStale(id)) return;
      dispatch({ type: "ROOM_DONE", version: { url: image, verification, engine: state.renderEngine } });
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  function renderRoom() {
    return runRender("RENDER_START");
  }

  function regenerateRoom() {
    return runRender("REGEN_START");
  }

  // Navigation that cancels any in-flight request by bumping the token.
  function pickAnother() {
    nextReq();
    dispatch({ type: "PICK_ANOTHER" });
  }
  function editPromptStep() {
    nextReq();
    dispatch({ type: "EDIT_PROMPT_STEP" });
  }
  function goOverview() {
    nextReq();
    dispatch({ type: "GO_OVERVIEW" });
  }
  function resetAll() {
    nextReq();
    dispatch({ type: "RESET" });
  }

  return (
    <section className="space-y-6">
      {state.step === "upload" && (
        <Hero onPlanSelected={(dataUrl) => dispatch({ type: "SET_PLAN", dataUrl })} />
      )}

      {state.step !== "upload" && <StepBar step={state.step} />}

      {state.step === "overview" && state.planDataUrl && (
        <OverviewView
          planDataUrl={state.planDataUrl}
          overviewDataUrl={state.overviewDataUrl}
          brief={state.brief}
          loading={state.loading}
          onBriefChange={(patch) => dispatch({ type: "SET_BRIEF", patch })}
          onGenerate={generateOverview}
          onApprove={() => dispatch({ type: "APPROVE" })}
          onReset={resetAll}
        />
      )}

      {state.step === "select" && state.planDataUrl && (
        <RoomSelector
          imageSrc={state.planDataUrl}
          referenceSrc={state.overviewDataUrl}
          loading={state.stage !== "idle"}
          onSelect={selectRoom}
          onBack={goOverview}
        />
      )}

      {state.step === "roomSetup" && (
        <RoomSetup
          cropDataUrl={state.cropDataUrl}
          roomType={state.roomType}
          styleId={state.roomStyleId}
          engine={state.renderEngine}
          onRoomTypeChange={(value) => dispatch({ type: "SET_ROOM_TYPE", value })}
          onStyleChange={(styleId) => dispatch({ type: "SET_ROOM_STYLE", styleId })}
          onEngineChange={(engine) => dispatch({ type: "SET_ENGINE", engine })}
          onGenerate={confirmSetup}
          onBack={pickAnother}
        />
      )}

      {state.step === "roomPrompt" && (
        <RoomPrompt
          cropDataUrl={state.cropDataUrl}
          boxes={state.boxes}
          blockoutDataUrl={state.blockoutDataUrl}
          layoutLock={state.layoutLock}
          prompt={state.roomPrompt}
          stage={state.stage}
          error={state.error}
          onPromptChange={(value) => dispatch({ type: "EDIT_PROMPT", value })}
          onRender={renderRoom}
          onRewrite={rewritePrompt}
          onBack={pickAnother}
        />
      )}

      {state.step === "room" && (
        <RoomResult
          cropDataUrl={state.cropDataUrl}
          boxes={state.boxes}
          blockoutDataUrl={state.blockoutDataUrl}
          layoutLock={state.layoutLock}
          versions={state.roomVersions}
          currentIndex={state.currentVersion}
          loading={state.loading}
          error={state.error}
          onRegenerate={regenerateRoom}
          onEditPrompt={editPromptStep}
          onPrev={() =>
            dispatch({
              type: "SET_VERSION",
              index: Math.max(0, state.currentVersion - 1),
            })
          }
          onNext={() =>
            dispatch({
              type: "SET_VERSION",
              index: Math.min(
                state.roomVersions.length - 1,
                state.currentVersion + 1,
              ),
            })
          }
          onPickAnother={pickAnother}
        />
      )}

      {state.error && state.step !== "room" && state.step !== "roomPrompt" && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
    </section>
  );
}
