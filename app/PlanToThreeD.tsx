"use client";

import { useReducer } from "react";
import PlanUploader from "./components/PlanUploader";
import OverviewView from "./components/OverviewView";
import RoomSelector from "./components/RoomSelector";
import RoomPrompt from "./components/RoomPrompt";
import RoomResult from "./components/RoomResult";
import { requestOverview, requestRoomPrompt, requestRoomRender } from "@/lib/api";
import { cropToDataUrl, type Rect } from "@/lib/crop";
import { DEFAULT_BRIEF } from "@/lib/styles";
import type { DesignBrief, RoomType } from "@/lib/types";

type Step = "upload" | "overview" | "select" | "roomPrompt" | "room";
type Stage = "idle" | "writing" | "rendering";

interface State {
  step: Step;
  planDataUrl: string | null;
  brief: DesignBrief;
  overviewDataUrl: string | null;
  cropDataUrl: string | null;
  roomType: RoomType;
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
  | { type: "BEGIN_ROOM"; dataUrl: string }
  | { type: "PROMPT_DONE"; prompt: string }
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
  roomType: "auto",
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
    case "BEGIN_ROOM":
      return {
        ...state,
        step: "roomPrompt",
        cropDataUrl: action.dataUrl,
        roomPrompt: "",
        roomVersions: [],
        currentVersion: 0,
        variation: 0,
        stage: "writing",
        error: null,
      };
    case "PROMPT_DONE":
      return { ...state, stage: "idle", roomPrompt: action.prompt };
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
      return { ...state, step: "roomPrompt", stage: "idle", error: null };
    case "PICK_ANOTHER":
      return {
        ...state,
        step: "select",
        cropDataUrl: null,
        roomPrompt: "",
        roomVersions: [],
        currentVersion: 0,
        variation: 0,
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

  async function generateOverview() {
    if (!state.planDataUrl) return;
    dispatch({ type: "LOAD_OVERVIEW" });
    try {
      const image = await requestOverview(state.planDataUrl, state.brief);
      dispatch({ type: "OVERVIEW_DONE", dataUrl: image });
    } catch (err) {
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // Write (or rewrite) the interior prompt for the current crop.
  async function writePrompt(crop: string) {
    try {
      const prompt = await requestRoomPrompt(crop, state.brief, state.roomType);
      dispatch({ type: "PROMPT_DONE", prompt });
    } catch (err) {
      // Leave the box editable so the user can still write a prompt by hand.
      dispatch({ type: "PROMPT_DONE", prompt: "" });
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // Crop the selection, move to the prompt step, and auto-write a prompt.
  async function selectRoom(rect: Rect) {
    if (!state.planDataUrl) return;
    let crop: string;
    try {
      crop = await cropToDataUrl(state.planDataUrl, rect);
    } catch (err) {
      dispatch({ type: "ERROR", message: message(err) });
      return;
    }
    dispatch({ type: "BEGIN_ROOM", dataUrl: crop });
    await writePrompt(crop);
  }

  function rewritePrompt() {
    if (!state.cropDataUrl) return;
    dispatch({ type: "REWRITE" });
    void writePrompt(state.cropDataUrl);
  }

  async function renderRoom() {
    if (!state.cropDataUrl) return;
    dispatch({ type: "RENDER_START" });
    try {
      const image = await requestRoomRender(
        state.cropDataUrl,
        state.roomPrompt,
        state.variation,
        state.overviewDataUrl ?? undefined,
      );
      dispatch({ type: "ROOM_DONE", dataUrl: image });
    } catch (err) {
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  async function regenerateRoom() {
    if (!state.cropDataUrl) return;
    dispatch({ type: "REGEN_START" });
    try {
      const image = await requestRoomRender(
        state.cropDataUrl,
        state.roomPrompt,
        state.variation,
        state.overviewDataUrl ?? undefined,
      );
      dispatch({ type: "ROOM_DONE", dataUrl: image });
    } catch (err) {
      dispatch({ type: "ERROR", message: message(err) });
    }
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
          onReset={() => dispatch({ type: "RESET" })}
        />
      )}

      {state.step === "select" && state.planDataUrl && (
        <RoomSelector
          planDataUrl={state.planDataUrl}
          loading={state.stage !== "idle"}
          roomType={state.roomType}
          onRoomTypeChange={(value) => dispatch({ type: "SET_ROOM_TYPE", value })}
          onSelect={selectRoom}
          onBack={() => dispatch({ type: "GO_OVERVIEW" })}
        />
      )}

      {state.step === "roomPrompt" && (
        <RoomPrompt
          cropDataUrl={state.cropDataUrl}
          prompt={state.roomPrompt}
          stage={state.stage}
          error={state.error}
          onPromptChange={(value) => dispatch({ type: "EDIT_PROMPT", value })}
          onRender={renderRoom}
          onRewrite={rewritePrompt}
          onBack={() => dispatch({ type: "PICK_ANOTHER" })}
        />
      )}

      {state.step === "room" && (
        <RoomResult
          cropDataUrl={state.cropDataUrl}
          versions={state.roomVersions}
          currentIndex={state.currentVersion}
          loading={state.loading}
          error={state.error}
          onRegenerate={regenerateRoom}
          onEditPrompt={() => dispatch({ type: "EDIT_PROMPT_STEP" })}
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
          onPickAnother={() => dispatch({ type: "PICK_ANOTHER" })}
        />
      )}

      {state.error && state.step !== "room" && state.step !== "roomPrompt" && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
    </section>
  );
}
