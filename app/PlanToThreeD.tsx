"use client";

import { useReducer } from "react";
import PlanUploader from "./components/PlanUploader";
import OverviewView from "./components/OverviewView";
import RoomSelector from "./components/RoomSelector";
import RoomResult from "./components/RoomResult";
import { requestOverview, requestRoom } from "@/lib/api";
import { cropToDataUrl, type Rect } from "@/lib/crop";

type Step = "upload" | "overview" | "select" | "room";

interface State {
  step: Step;
  planDataUrl: string | null;
  overviewDataUrl: string | null;
  cropDataUrl: string | null;
  roomVersions: string[];
  currentVersion: number;
  /** Increments on each room generation to vary the prompt. */
  variation: number;
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: "SET_PLAN"; dataUrl: string }
  | { type: "LOADING" }
  | { type: "ERROR"; message: string }
  | { type: "OVERVIEW_DONE"; dataUrl: string }
  | { type: "GO_SELECT" }
  | { type: "GO_OVERVIEW" }
  | { type: "SET_CROP"; dataUrl: string }
  | { type: "ROOM_DONE"; dataUrl: string }
  | { type: "SET_VERSION"; index: number }
  | { type: "PICK_ANOTHER" }
  | { type: "RESET" };

const initialState: State = {
  step: "upload",
  planDataUrl: null,
  overviewDataUrl: null,
  cropDataUrl: null,
  roomVersions: [],
  currentVersion: 0,
  variation: 0,
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_PLAN":
      return {
        ...initialState,
        planDataUrl: action.dataUrl,
        step: "overview",
      };
    case "LOADING":
      return { ...state, loading: true, error: null };
    case "ERROR":
      return { ...state, loading: false, error: action.message };
    case "OVERVIEW_DONE":
      return { ...state, loading: false, overviewDataUrl: action.dataUrl };
    case "GO_SELECT":
      return { ...state, step: "select", error: null };
    case "GO_OVERVIEW":
      return { ...state, step: "overview", error: null };
    case "SET_CROP":
      return {
        ...state,
        step: "room",
        cropDataUrl: action.dataUrl,
        roomVersions: [],
        currentVersion: 0,
        variation: 0,
      };
    case "ROOM_DONE": {
      const roomVersions = [...state.roomVersions, action.dataUrl];
      return {
        ...state,
        loading: false,
        roomVersions,
        currentVersion: roomVersions.length - 1,
        variation: state.variation + 1,
      };
    }
    case "SET_VERSION":
      return { ...state, currentVersion: action.index };
    case "PICK_ANOTHER":
      return {
        ...state,
        step: "select",
        cropDataUrl: null,
        roomVersions: [],
        currentVersion: 0,
        variation: 0,
        error: null,
      };
    case "RESET":
      return initialState;
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
    dispatch({ type: "LOADING" });
    try {
      const image = await requestOverview(state.planDataUrl);
      dispatch({ type: "OVERVIEW_DONE", dataUrl: image });
    } catch (err) {
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // Crop the selected region, then immediately generate the first room render.
  async function selectRoom(rect: Rect) {
    if (!state.planDataUrl) return;
    dispatch({ type: "LOADING" });
    try {
      const crop = await cropToDataUrl(state.planDataUrl, rect);
      dispatch({ type: "SET_CROP", dataUrl: crop });
      const image = await requestRoom(crop, 0);
      dispatch({ type: "ROOM_DONE", dataUrl: image });
    } catch (err) {
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  async function regenerateRoom() {
    if (!state.cropDataUrl) return;
    dispatch({ type: "LOADING" });
    try {
      const image = await requestRoom(state.cropDataUrl, state.variation);
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
          loading={state.loading}
          onGenerate={generateOverview}
          onProceed={() => dispatch({ type: "GO_SELECT" })}
          onReset={() => dispatch({ type: "RESET" })}
        />
      )}

      {state.step === "select" && state.planDataUrl && (
        <RoomSelector
          planDataUrl={state.planDataUrl}
          loading={state.loading}
          onSelect={selectRoom}
          onBack={() => dispatch({ type: "GO_OVERVIEW" })}
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

      {state.error && state.step !== "room" && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
    </section>
  );
}
