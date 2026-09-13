"use client";

import { useReducer, useRef } from "react";
import Hero from "./components/Hero";
import StepBar from "./components/StepBar";
import HouseStep, { type HouseStatus } from "./components/HouseStep";
import RoomSelector from "./components/RoomSelector";
import RoomSetup from "./components/RoomSetup";
import RoomPrompt from "./components/RoomPrompt";
import RoomResult from "./components/RoomResult";
import { requestHouse, requestOverview, requestRoomPrompt, requestRoomRender } from "@/lib/api";
import { buildBlockoutMaps } from "@/lib/blockout";
import {
  finalizeHouse,
  roomAspectOf,
  roomLocalBoxes,
  roomRectPx,
  roomSizeOf,
  roomTypeFromLabel,
  type HouseModel,
} from "@/lib/house";
import { renderHouseIso } from "@/lib/houseScene";
import { summarizeLabels, describeLayout, isHelperLabel, type RoomSize, type SpatialBox } from "@/lib/spatial";
import { cropToDataUrl, imageSize, type Rect } from "@/lib/crop";
import { DEFAULT_BRIEF } from "@/lib/styles";
import type { DesignBrief, LayoutVerification, RenderEngine, RoomType } from "@/lib/types";

type Step = "upload" | "house" | "select" | "roomSetup" | "roomPrompt" | "room";
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
  /** Natural pixel size of the plan, for room crops and the house scale. */
  planSize: { width: number; height: number } | null;
  brief: DesignBrief;
  /** The whole plan as one model (rooms, walls, openings, furniture) — Stage 0. */
  house: HouseModel | null;
  houseStatus: HouseStatus;
  /** Our own axonometric clay render of the house (the AI overview's reference). */
  houseMassingDataUrl: string | null;
  /** Room picked in the house model. */
  selectedRoom: number | null;
  overviewDataUrl: string | null;
  cropDataUrl: string | null;
  /** Pixel aspect (w/h) of the room crop, used to proportion the 3D blockout. */
  cropAspect: number;
  /** Label of the room being worked on (from the house model), for headings. */
  roomLabel: string | null;
  /** True when `boxes` came from the house model, so the prompt writer skips detection. */
  knownLayout: boolean;
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
  /** The detected boxes themselves, drawn over the crop so the lock is inspectable (and editable). */
  boxes: SpatialBox[];
  /** Real room size read from the plan, kept so an edited layout rebuilds at true scale. */
  roomSize: RoomSize | null;
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
  | { type: "SET_PLAN"; dataUrl: string; size: { width: number; height: number } | null }
  | { type: "SET_BRIEF"; patch: Partial<DesignBrief> }
  | { type: "HOUSE_START" }
  | { type: "HOUSE_DONE"; house: HouseModel }
  | { type: "HOUSE_MASSING"; dataUrl: string | null }
  | { type: "HOUSE_FAILED"; message: string }
  | { type: "SELECT_HOUSE_ROOM"; index: number | null }
  | { type: "LOAD_OVERVIEW" }
  | { type: "OVERVIEW_DONE"; dataUrl: string }
  | { type: "GO_SELECT" }
  | { type: "GO_HOUSE" }
  | { type: "SET_ROOM_TYPE"; value: RoomType }
  | { type: "SET_ROOM_STYLE"; styleId: string }
  | { type: "SET_ENGINE"; engine: RenderEngine }
  | {
      type: "BEGIN_SETUP";
      dataUrl: string;
      aspect: number;
      /** Layout known from the house model (skips detection), else detected per crop. */
      known?: { boxes: SpatialBox[]; roomSize: RoomSize; label: string; roomType: RoomType };
    }
  | { type: "START_WRITE" }
  | {
      type: "PROMPT_DONE";
      prompt: string;
      blockout: string | null;
      depth: string | null;
      lock: LayoutLock;
      layout: string;
      boxes: SpatialBox[];
      roomSize: RoomSize | null;
    }
  /** The user edited the boxes: show them at once, the rebuild follows. */
  | { type: "SET_BOXES"; boxes: SpatialBox[] }
  | { type: "LAYOUT_REBUILT"; blockout: string | null; depth: string | null; lock: LayoutLock; layout: string }
  | { type: "SET_ROOM_SIZE"; roomSize: RoomSize }
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
  roomLabel: null,
  knownLayout: false,
  blockoutDataUrl: null,
  depthDataUrl: null,
  layoutLock: { status: "none", count: 0, summary: "" },
  layoutText: "",
  boxes: [],
  roomSize: null,
  roomPrompt: "",
  roomVersions: [],
  currentVersion: 0,
  variation: 0,
} satisfies Partial<State>;

const initialState: State = {
  step: "upload",
  planDataUrl: null,
  planSize: null,
  brief: DEFAULT_BRIEF,
  house: null,
  houseStatus: "idle",
  houseMassingDataUrl: null,
  selectedRoom: null,
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
        renderEngine: state.renderEngine,
        planDataUrl: action.dataUrl,
        planSize: action.size,
        step: "house",
        houseStatus: "reading",
      };
    case "SET_BRIEF":
      return { ...state, brief: { ...state.brief, ...action.patch } };
    case "HOUSE_START":
      return { ...state, houseStatus: "reading", house: null, houseMassingDataUrl: null, selectedRoom: null, error: null };
    case "HOUSE_DONE":
      return { ...state, houseStatus: "ready", house: action.house, selectedRoom: null, error: null };
    case "HOUSE_MASSING":
      return { ...state, houseMassingDataUrl: action.dataUrl };
    case "HOUSE_FAILED":
      return { ...state, houseStatus: "failed", house: null, error: action.message };
    case "SELECT_HOUSE_ROOM":
      return { ...state, selectedRoom: action.index };
    case "LOAD_OVERVIEW":
      return { ...state, loading: true, error: null };
    case "OVERVIEW_DONE":
      return { ...state, loading: false, overviewDataUrl: action.dataUrl };
    case "GO_SELECT":
      return { ...state, step: "select", error: null };
    case "GO_HOUSE":
      return { ...state, step: "house", error: null, loading: false, stage: "idle" };
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
        ...(action.known
          ? {
              boxes: action.known.boxes,
              roomSize: action.known.roomSize,
              roomLabel: action.known.label,
              knownLayout: true,
            }
          : {}),
        roomType: action.known ? action.known.roomType : state.roomType,
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
        roomSize: action.roomSize,
      };
    case "SET_BOXES":
      return { ...state, boxes: action.boxes };
    case "SET_ROOM_SIZE":
      return { ...state, roomSize: action.roomSize };
    case "LAYOUT_REBUILT":
      return {
        ...state,
        blockoutDataUrl: action.blockout,
        depthDataUrl: action.depth,
        layoutLock: action.lock,
        layoutText: action.layout,
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
        // Back to the house model when there is one, else to drawing a box.
        step: state.houseStatus === "ready" ? "house" : "select",
        cropDataUrl: null,
        ...FRESH_ROOM,
        loading: false,
        stage: "idle",
        error: null,
      };
    case "ERROR":
      return { ...state, loading: false, stage: "idle", error: action.message };
    case "RESET":
      return { ...initialState, brief: state.brief, renderEngine: state.renderEngine };
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

  // Reading the house is bound to the plan, not to the request token: a room
  // flow started later must not cancel it.
  const houseReq = useRef(0);

  /**
   * Stage 0: read the WHOLE plan into one model, then build our own
   * axonometric clay render of it (the overview's reference + evidence).
   */
  async function readHouse(planDataUrl: string, size: { width: number; height: number } | null) {
    const id = (houseReq.current += 1);
    dispatch({ type: "HOUSE_START" });
    const aspect = size && size.height > 0 ? size.width / size.height : 1;
    let house: HouseModel;
    try {
      const raw = await requestHouse(planDataUrl);
      if (houseReq.current !== id) return;
      house = finalizeHouse(raw, aspect);
      dispatch({ type: "HOUSE_DONE", house });
    } catch (err) {
      if (houseReq.current !== id) return;
      dispatch({ type: "HOUSE_FAILED", message: message(err) });
      return;
    }
    try {
      const massing = await renderHouseIso(house);
      if (houseReq.current !== id) return;
      dispatch({ type: "HOUSE_MASSING", dataUrl: massing });
    } catch {
      /* the flow continues without the clay overview */
    }
  }

  async function setPlan(dataUrl: string) {
    nextReq();
    let size: { width: number; height: number } | null = null;
    try {
      size = await imageSize(dataUrl);
    } catch {
      size = null;
    }
    dispatch({ type: "SET_PLAN", dataUrl, size });
    void readHouse(dataUrl, size);
  }

  function retryHouse() {
    if (!state.planDataUrl) return;
    void readHouse(state.planDataUrl, state.planSize);
  }

  async function generateOverview() {
    if (!state.planDataUrl) return;
    const id = nextReq();
    dispatch({ type: "LOAD_OVERVIEW" });
    try {
      // Styled from our own clay model of the house when it exists, so the
      // overview's rooms, walls and openings are the plan's, not a re-drawing.
      const image = await requestOverview(state.planDataUrl, state.brief, state.houseMassingDataUrl ?? undefined);
      if (isStale(id)) return;
      dispatch({ type: "OVERVIEW_DONE", dataUrl: image });
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
    }
  }

  // The clay massing + depth map + layout text for a set of boxes. Pure
  // client-side work, so an edited layout rebuilds for free.
  async function buildLayout(boxes: SpatialBox[], roomSize: RoomSize | null, cropAspect = state.cropAspect) {
    // Best-effort: a null blockout (no boxes / no WebGL) falls back to text-to-image.
    let blockout: string | null = null;
    let depth: string | null = null;
    try {
      const maps = await buildBlockoutMaps(boxes, cropAspect, { roomSize });
      blockout = maps?.clay ?? null;
      depth = maps?.depth ?? null;
    } catch {
      blockout = null;
    }
    const lock: LayoutLock = {
      count: boxes.filter((b) => !isHelperLabel(b.label)).length,
      status: boxes.length === 0 ? "no-objects" : blockout ? "locked" : "no-webgl",
      summary: summarizeLabels(boxes),
    };
    return { blockout, depth, lock, layout: describeLayout(boxes) };
  }

  // The user corrected the detection (on the crop or in the 3D editor):
  // rebuild the lock from the edited boxes without another detection call.
  const rebuildId = useRef(0);
  async function editBoxes(boxes: SpatialBox[]) {
    dispatch({ type: "SET_BOXES", boxes });
    const id = (rebuildId.current += 1);
    const built = await buildLayout(boxes, state.roomSize);
    if (rebuildId.current !== id) return;
    dispatch({ type: "LAYOUT_REBUILT", ...built });
  }
  async function editRoomSize(roomSize: RoomSize) {
    if (!(roomSize.width > 0.5) || !(roomSize.depth > 0.5)) return;
    dispatch({ type: "SET_ROOM_SIZE", roomSize });
    const id = (rebuildId.current += 1);
    const built = await buildLayout(state.boxes, roomSize);
    if (rebuildId.current !== id) return;
    dispatch({ type: "LAYOUT_REBUILT", ...built });
  }

  // Write (or rewrite) the interior prompt for the current crop, and build the
  // eye-level 3D blockout from the room's boxes so the render can lock layout.
  // With a layout known from the house model the writer skips detection and
  // the boxes (as the user may have edited them) are the ground truth.
  async function writePrompt(crop: string, id: number) {
    try {
      const known = state.knownLayout ? { boxes: state.boxes, roomSize: state.roomSize } : undefined;
      const { prompt, boxes, roomSize } = await requestRoomPrompt(
        crop,
        effectiveBrief(),
        state.roomType,
        state.overviewDataUrl ?? undefined,
        known,
      );
      if (isStale(id)) return;
      const { blockout, depth, lock, layout } = await buildLayout(boxes, roomSize);
      if (isStale(id)) return;
      if (typeof console !== "undefined") {
        console.debug("[voxa] layout lock:", lock.status, "boxes:", boxes.length, "blockout:", Boolean(blockout));
      }
      dispatch({ type: "PROMPT_DONE", prompt, blockout, depth, lock, layout, boxes, roomSize });
    } catch (err) {
      if (isStale(id)) return;
      // Leave the box editable so the user can still write a prompt by hand;
      // a known layout is kept so the lock still builds.
      const boxes = state.knownLayout ? state.boxes : [];
      const roomSize = state.knownLayout ? state.roomSize : null;
      const built = boxes.length ? await buildLayout(boxes, roomSize) : null;
      if (isStale(id)) return;
      dispatch({
        type: "PROMPT_DONE",
        prompt: "",
        blockout: built?.blockout ?? null,
        depth: built?.depth ?? null,
        lock: built?.lock ?? { status: "none", count: 0, summary: "" },
        layout: built?.layout ?? "",
        boxes,
        roomSize,
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

  /**
   * A room picked in the house model: crop its rectangle from the plan and
   * carry its layout (openings on its walls, furniture inside it) and true
   * size straight from the model — no per-room detection.
   */
  async function renderHouseRoom() {
    const { house, planDataUrl, planSize, selectedRoom } = state;
    if (!house || !planDataUrl || selectedRoom === null || !house.rooms[selectedRoom]) return;
    const id = nextReq();
    const natural = planSize ?? { width: 1000, height: 1000 };
    let crop: string;
    try {
      crop = await cropToDataUrl(planDataUrl, roomRectPx(house, selectedRoom, natural.width, natural.height));
    } catch (err) {
      if (isStale(id)) return;
      dispatch({ type: "ERROR", message: message(err) });
      return;
    }
    if (isStale(id)) return;
    const planAspect = natural.height > 0 ? natural.width / natural.height : 1;
    const label = house.rooms[selectedRoom].label;
    dispatch({
      type: "BEGIN_SETUP",
      dataUrl: crop,
      aspect: roomAspectOf(house, selectedRoom, planAspect),
      known: {
        boxes: roomLocalBoxes(house, selectedRoom),
        roomSize: roomSizeOf(house, selectedRoom),
        label,
        roomType: roomTypeFromLabel(label),
      },
    });
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
  function goHouse() {
    nextReq();
    dispatch({ type: "GO_HOUSE" });
  }
  function goSelect() {
    nextReq();
    dispatch({ type: "GO_SELECT" });
  }
  function resetAll() {
    nextReq();
    houseReq.current += 1;
    dispatch({ type: "RESET" });
  }

  return (
    <section className="space-y-6">
      {state.step === "upload" && <Hero onPlanSelected={(dataUrl) => void setPlan(dataUrl)} />}

      {state.step !== "upload" && <StepBar step={state.step} />}

      {state.step === "house" && state.planDataUrl && (
        <HouseStep
          planDataUrl={state.planDataUrl}
          brief={state.brief}
          house={state.house}
          houseStatus={state.houseStatus}
          massingDataUrl={state.houseMassingDataUrl}
          overviewDataUrl={state.overviewDataUrl}
          overviewLoading={state.loading}
          selectedRoom={state.selectedRoom}
          error={state.error}
          onBriefChange={(patch) => dispatch({ type: "SET_BRIEF", patch })}
          onSelectRoom={(index) => dispatch({ type: "SELECT_HOUSE_ROOM", index })}
          onRenderRoom={() => void renderHouseRoom()}
          onRetryHouse={retryHouse}
          onGenerateOverview={() => void generateOverview()}
          onDrawBox={goSelect}
          onReset={resetAll}
        />
      )}

      {state.step === "select" && state.planDataUrl && (
        <RoomSelector
          imageSrc={state.planDataUrl}
          referenceSrc={state.overviewDataUrl ?? state.houseMassingDataUrl}
          loading={state.stage !== "idle"}
          onSelect={selectRoom}
          onBack={goHouse}
        />
      )}

      {state.step === "roomSetup" && (
        <RoomSetup
          cropDataUrl={state.cropDataUrl}
          roomLabel={state.roomLabel}
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
          cropAspect={state.cropAspect}
          roomSize={state.roomSize}
          blockoutDataUrl={state.blockoutDataUrl}
          layoutLock={state.layoutLock}
          knownLayout={state.knownLayout}
          prompt={state.roomPrompt}
          stage={state.stage}
          error={state.error}
          onPromptChange={(value) => dispatch({ type: "EDIT_PROMPT", value })}
          onBoxesChange={editBoxes}
          onRoomSizeChange={editRoomSize}
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
          cropAspect={state.cropAspect}
          roomSize={state.roomSize}
          onBoxesChange={editBoxes}
          onRoomSizeChange={editRoomSize}
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

      {state.error && state.step !== "room" && state.step !== "roomPrompt" && state.step !== "house" && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
    </section>
  );
}
