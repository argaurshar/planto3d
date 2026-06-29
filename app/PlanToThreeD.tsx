"use client";

import { useReducer, useRef } from "react";
import PlanUploader from "./components/PlanUploader";
import OverviewView from "./components/OverviewView";
import RoomSelector from "./components/RoomSelector";
import RoomSetup from "./components/RoomSetup";
import RoomPrompt from "./components/RoomPrompt";
import RoomResult from "./components/RoomResult";
import { requestOverview, requestRoomPrompt, requestRoomRender } from "@/lib/api";
import { buildBlockoutDataUrl } from "@/lib/blockout";
import { cropToDataUrl, type Rect } from "@/lib/crop";
import { DEFAULT_BRIEF } from "@/lib/styles";
import type { DesignBrief, RoomType } from "@/lib/types";

type Step = "upload" | "overview" | "select" | "roomSetup" | "roomPrompt" | "room";
type Stage = "idle" | "writing" | "rendering";

/** Whether the render is geometry-locked to a blockout, and why not if not. */
export type LayoutLock = {
  status: "none" | "locked" | "no-webgl" | "no-objects";
  count: number;
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
  /** Status of the layout lock (detected object count + why it's on/off). */
  layoutLock: LayoutLock;
  roomType: RoomType;
  /** Per-room style override (defaults to the brief's style). */
  roomStyleId: string;
  roomPrompt: string;
  roomVersions: string[];
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
  | { type: "BEGIN_SETUP"; dataUrl: string; aspect: number }
  | { type: "START_WRITE" }
  | { type: "PROMPT_DONE"; prompt: string; blockout: string | null; lock: LayoutLock }
  | { type: "REWRITE" }
  | { type: "EDIT_PROMPT"; value: string }
  | { type: "RENDER_START" }
  | { type: "REGEN_START" }
  | { type: "ROOM_DONE"; dataUrl: string }
  | { type: "SET_VERSION"; index: number }
  | { type: "EDIT_PROMPT_STEP" }
  | { type: "PICK_ANOTHER" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

const initialState: State = {
  step: "upload",
  planDataUrl: null,
  brief: DEFAULT_BRIEF,
  overviewDataUrl: null,
  cropDataUrl: null,
  cropAspect: 1,
  blockoutDataUrl: null,
  layoutLock: { status: "none", count: 0 },
  roomType: "auto",
  roomStyleId: DEFAULT_BRIEF.styleId,
  roomPrompt: "",
  roomVersions: [],
  currentVersion: 0,
  variation: 0,
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
    case "BEGIN_SETUP":
      return {
        ...state,
        step: "roomSetup",
        cropDataUrl: action.dataUrl,
        cropAspect: action.aspect,
        blockoutDataUrl: null,
        layoutLock: { status: "none", count: 0 },
        roomStyleId: state.brief.styleId,
        roomPrompt: "",
        roomVersions: [],
        currentVersion: 0,
        variation: 0,
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
        layoutLock: action.lock,
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
      const roomVersions = [...state.roomVersions, action.dataUrl];
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
        blockoutDataUrl: null,
        layoutLock: { status: "none", count: 0 },
        roomPrompt: "",
        roomVersions: [],
        currentVersion: 0,
        variation: 0,
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
      const { prompt, boxes } = await requestRoomPrompt(
        crop,
        effectiveBrief(),
        state.roomType,
        state.overviewDataUrl ?? undefined,
      );
      if (isStale(id)) return;
      // Best-effort: a null blockout (no boxes / no WebGL) falls back to text-to-image.
      let blockout: string | null = null;
      try {
        blockout = await buildBlockoutDataUrl(boxes, state.cropAspect);
      } catch {
        blockout = null;
      }
      if (isStale(id)) return;
      const lock: LayoutLock = {
        count: boxes.length,
        status: boxes.length === 0 ? "no-objects" : blockout ? "locked" : "no-webgl",
      };
      if (typeof console !== "undefined") {
        console.debug("[voxa] layout lock:", lock.status, "boxes:", boxes.length, "blockout:", Boolean(blockout));
      }
      dispatch({ type: "PROMPT_DONE", prompt, blockout, lock });
    } catch (err) {
      if (isStale(id)) return;
      // Leave the box editable so the user can still write a prompt by hand.
      dispatch({ type: "PROMPT_DONE", prompt: "", blockout: null, lock: { status: "none", count: 0 } });
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // Crop the selection from the 3D overview and move to the per-room setup table.
  async function selectRoom(rect: Rect) {
    if (!state.overviewDataUrl) return;
    const id = nextReq();
    let crop: string;
    try {
      crop = await cropToDataUrl(state.overviewDataUrl, rect);
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

  async function renderRoom() {
    if (!state.cropDataUrl) return;
    const id = nextReq();
    dispatch({ type: "RENDER_START" });
    try {
      const image = await requestRoomRender(
        state.roomPrompt,
        state.variation,
        effectiveBrief(),
        state.blockoutDataUrl ?? undefined,
      );
      if (isStale(id)) return;
      dispatch({ type: "ROOM_DONE", dataUrl: image });
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  async function regenerateRoom() {
    if (!state.cropDataUrl) return;
    const id = nextReq();
    dispatch({ type: "REGEN_START" });
    try {
      const image = await requestRoomRender(
        state.roomPrompt,
        state.variation,
        effectiveBrief(),
        state.blockoutDataUrl ?? undefined,
      );
      if (isStale(id)) return;
      dispatch({ type: "ROOM_DONE", dataUrl: image });
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
    }
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
        <PlanUploader
          onPlanSelected={(dataUrl) => dispatch({ type: "SET_PLAN", dataUrl })}
        />
      )}

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

      {state.step === "select" && state.overviewDataUrl && (
        <RoomSelector
          imageSrc={state.overviewDataUrl}
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
          onRoomTypeChange={(value) => dispatch({ type: "SET_ROOM_TYPE", value })}
          onStyleChange={(styleId) => dispatch({ type: "SET_ROOM_STYLE", styleId })}
          onGenerate={confirmSetup}
          onBack={pickAnother}
        />
      )}

      {state.step === "roomPrompt" && (
        <RoomPrompt
          cropDataUrl={state.cropDataUrl}
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
