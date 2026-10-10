"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { RoomModel, Shot } from "@/lib/room/types";
import type { RoomViewport } from "@/lib/room/viewport";

export interface Viewport3DHandle {
  /** Render a shot at full size (1600×1200) and return a PNG data URL. */
  capture(shot: Shot): Promise<string>;
  /** The camera as it is now, as a shot (after the user orbits). */
  currentShot(): Shot | null;
}

interface Props {
  room: RoomModel;
  clay: boolean;
  /** Preset shot to show; a new object moves the camera even if the id repeats. */
  shot: Shot | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** An item was dragged to a new plan position. */
  onMove: (id: string, x: number, z: number) => void;
  /** The user orbited away from the preset shot. */
  onFreeCamera: () => void;
}

/**
 * The live 3D model. Click a piece to select it, drag a selected piece across
 * the floor to move it, drag empty space to orbit, scroll to zoom.
 */
const Viewport3D = forwardRef<Viewport3DHandle, Props>(function Viewport3D(
  { room, clay, shot, selectedId, onSelect, onMove, onFreeCamera },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const vpRef = useRef<RoomViewport | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef({ onSelect, onMove, onFreeCamera });
  cb.current = { onSelect, onMove, onFreeCamera };
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const latest = useRef({ room, clay });
  latest.current = { room, clay };
  // Resolves once WebGL is up, so a capture requested on load waits for it.
  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!readyRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => (resolve = r));
    readyRef.current = { promise, resolve };
  }

  useImperativeHandle(ref, () => ({
    capture: async (s: Shot) => {
      await Promise.race([readyRef.current!.promise, new Promise((_, rej) => setTimeout(() => rej(new Error("The 3D view did not start (is WebGL available?).")), 30000))]);
      const vp = vpRef.current;
      if (!vp) throw new Error("The 3D view is not available.");
      // Make sure the scene is the latest model before shooting it.
      if (vp.currentModel !== latest.current.room || vp.isClay !== latest.current.clay) vp.setRoom(latest.current.room, { clay: latest.current.clay });
      return vp.capture(s, 1600, 1200);
    },
    currentShot: () => vpRef.current?.currentShot("Your view") ?? null,
  }));

  // Create the renderer once.
  useEffect(() => {
    let disposed = false;
    let vp: RoomViewport | null = null;
    (async () => {
      try {
        const { RoomViewport } = await import("@/lib/room/viewport");
        if (disposed || !host.current) return;
        vp = await RoomViewport.create(host.current);
        if (disposed) {
          vp.dispose();
          return;
        }
        vp.onFreeCamera = () => cb.current.onFreeCamera();
        vpRef.current = vp;
        vp.setRoom(latest.current.room, { clay: latest.current.clay });
        setReady(true);
        readyRef.current!.resolve();
      } catch (e) {
        setError(e instanceof Error ? e.message : "WebGL is not available in this browser.");
      }
    })();
    return () => {
      disposed = true;
      vp?.dispose();
      vpRef.current = null;
    };
  }, []);

  // Rebuild the room whenever the model or the clay toggle changes.
  useEffect(() => {
    const vp = vpRef.current;
    if (!ready || !vp) return;
    if (vp.currentModel !== room || vp.isClay !== clay) vp.setRoom(room, { clay });
  }, [ready, room, clay]);

  useEffect(() => {
    if (ready && shot) vpRef.current?.setShot(shot);
  }, [ready, shot]);

  useEffect(() => {
    if (ready) vpRef.current?.select(selectedId);
  }, [ready, selectedId, room]);

  // Click to select; drag the selected piece to move it.
  useEffect(() => {
    if (!ready) return;
    const vp = vpRef.current!;
    const el = vp.canvas;
    let down: { x: number; y: number; id: string | null; offset: { x: number; z: number } | null } | null = null;
    let dragging = false;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = vp.pick(e.clientX, e.clientY);
      const sel = selectedRef.current;
      let offset: { x: number; z: number } | null = null;
      if (hit && hit === sel) {
        const p = vp.floorPoint(e.clientX, e.clientY);
        const at = vp.itemPosition(hit);
        if (p && at) {
          offset = { x: at.x - p.x, z: at.z - p.z };
          vp.setOrbitEnabled(false);
          el.setPointerCapture(e.pointerId);
        }
      }
      down = { x: e.clientX, y: e.clientY, id: hit, offset };
      dragging = false;
    };
    const onMoveEv = (e: PointerEvent) => {
      if (!down?.offset || !down.id) return;
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
      dragging = true;
      const p = vp.floorPoint(e.clientX, e.clientY);
      if (p) vp.previewMove(down.id, p.x + down.offset.x, p.z + down.offset.z);
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const d = down;
      down = null;
      vp.setOrbitEnabled(true);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (dragging && d.id) {
        const at = vp.itemPosition(d.id);
        if (at) cb.current.onMove(d.id, at.x, at.z);
        return;
      }
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) cb.current.onSelect(d.id);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMoveEv);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMoveEv);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [ready]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#d9d6d0]">
      <div ref={host} className="absolute inset-0" />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-600">Building the 3D model…</div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-700">
          3D view unavailable: {error}
        </div>
      )}
    </div>
  );
});

export default Viewport3D;
