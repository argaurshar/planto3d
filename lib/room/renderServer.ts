// Talking to the Voxa render server (blender-server/server.py): real Blender
// Cycles renders of the exact room, from the same camera as a raw shot.
//
// The browser builds the job (room.glb + scene.json, never a script), posts it,
// polls the job and downloads the PNG. The server's address can come from the
// build (NEXT_PUBLIC_BLENDER_SERVER_URL) or be set in the app; its token is
// only ever typed into this browser (localStorage), never built into the site.

import type { RoomModel, Shot } from "./types";

export interface RenderServer {
  url: string;
  token: string;
}

export interface ServerHealth {
  ok: boolean;
  blender: string | null;
  device: string | null;
  queue: number;
  authRequired: boolean;
  authorized: boolean;
}

export const QUALITIES = {
  draft: { label: "Draft", samples: 48, percent: 60, note: "fast check, ~1/3 of the pixels" },
  final: { label: "Final", samples: 256, percent: 100, note: "1600×1200, clean" },
} as const;
export type Quality = keyof typeof QUALITIES;

const STORAGE = "planto3d_render_server";
export const RENDER_SERVER_EVENT = "planto3d-render-server";

export function getRenderServer(): RenderServer | null {
  let saved: Partial<RenderServer> = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE) || "{}") as Partial<RenderServer>;
  } catch {
    /* blocked storage: fall back to the built-in address */
  }
  const url = (saved.url || process.env.NEXT_PUBLIC_BLENDER_SERVER_URL || "").trim().replace(/\/+$/, "");
  return url ? { url, token: (saved.token || "").trim() } : null;
}

export function setRenderServer(s: RenderServer | null): void {
  try {
    if (s && s.url.trim()) window.localStorage.setItem(STORAGE, JSON.stringify({ url: s.url.trim().replace(/\/+$/, ""), token: s.token.trim() }));
    else window.localStorage.removeItem(STORAGE);
  } catch {
    /* private mode: the setting lasts for this page */
  }
  window.dispatchEvent(new Event(RENDER_SERVER_EVENT));
}

function headers(s: RenderServer, extra: Record<string, string> = {}): Record<string, string> {
  return { ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...extra };
}

async function errorOf(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) return "The render server refused the token. Check it under “Blender render server” at the bottom of the page.";
  return j?.error || `Render server error (HTTP ${res.status}).`;
}

export async function serverHealth(s: RenderServer): Promise<ServerHealth> {
  let res: Response;
  try {
    res = await fetch(`${s.url}/health`, { headers: headers(s), cache: "no-store" });
  } catch {
    throw new Error("Could not reach the render server (is it running, and does it allow this site in ALLOWED_ORIGINS?).");
  }
  if (!res.ok) throw new Error(await errorOf(res));
  const j = (await res.json()) as Partial<ServerHealth> & { service?: string };
  if (j.service !== "voxa-render") throw new Error("That address answers, but it is not a Voxa render server.");
  return { ok: !!j.ok, blender: j.blender ?? null, device: j.device ?? null, queue: j.queue ?? 0, authRequired: !!j.authRequired, authorized: !!j.authorized };
}

interface JobStatus {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  position: number;
  shots: { id: string; done: boolean; image: string | null }[];
  device: string | null;
  elapsed: number;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read the render."));
    r.readAsDataURL(b);
  });
}

/**
 * Render one shot of the room in Blender on the server. Resolves to a PNG data
 * URL; `onStatus` gets short progress lines ("Queued, 1 ahead", "Rendering on OPTIX… 24 s").
 */
export async function renderInBlender(room: RoomModel, shot: Shot, quality: Quality, onStatus: (s: string) => void): Promise<string> {
  const server = getRenderServer();
  if (!server) throw new Error("Set the Blender render server at the bottom of the page first.");
  const q = QUALITIES[quality];
  onStatus("Packing the 3D model…");
  const { renderJobZip } = await import("./blender");
  const body = await renderJobZip(room, [shot]);
  onStatus("Uploading to the render server…");
  const params = new URLSearchParams({ shots: shot.id, samples: String(q.samples), percent: String(q.percent) });
  let res: Response;
  try {
    res = await fetch(`${server.url}/jobs?${params}`, { method: "POST", headers: headers(server, { "Content-Type": "application/zip" }), body });
  } catch {
    throw new Error("Could not reach the render server.");
  }
  if (!res.ok) throw new Error(await errorOf(res));
  let job = (await res.json()) as JobStatus;
  const deadline = Date.now() + 40 * 60 * 1000;
  while (job.status === "queued" || job.status === "running") {
    onStatus(job.status === "queued" ? (job.position ? `Queued, ${job.position} ahead…` : "Starting Blender…") : `Rendering in Blender${job.device ? ` on ${job.device}` : ""}… ${Math.round(job.elapsed)} s`);
    if (Date.now() > deadline) throw new Error("The render is taking too long; try Draft quality.");
    await sleep(2000);
    const r = await fetch(`${server.url}/jobs/${job.id}`, { headers: headers(server), cache: "no-store" }).catch(() => null);
    if (r?.ok) job = (await r.json()) as JobStatus;
    else if (r && r.status !== 502 && r.status !== 503) throw new Error(await errorOf(r));
  }
  if (job.status === "failed") throw new Error(`Blender could not render it: ${job.error ?? "unknown error"}`);
  const img = job.shots.find((s) => s.id === shot.id)?.image;
  if (!img) throw new Error("The server finished without an image.");
  const png = await fetch(`${server.url}${img}`, { headers: headers(server) });
  if (!png.ok) throw new Error(await errorOf(png));
  return blobToDataUrl(await png.blob());
}
