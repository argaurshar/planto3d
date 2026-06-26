import type { GenerateImageResponse } from "./types";

async function postImage(
  url: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // ignore parse errors, keep default message
    }
    throw new Error(message);
  }
  const data = (await res.json()) as GenerateImageResponse;
  return data.image;
}

/** Generate the whole-plan axonometric overview. Returns an image data URL. */
export function requestOverview(planDataUrl: string): Promise<string> {
  return postImage("/api/overview", { plan: planDataUrl });
}

/** Generate a 3D render of a single cropped room. Returns an image data URL. */
export function requestRoom(
  roomDataUrl: string,
  variation: number,
): Promise<string> {
  return postImage("/api/room", { room: roomDataUrl, variation });
}
