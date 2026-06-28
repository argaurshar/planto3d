import type {
  DesignBrief,
  GenerateImageResponse,
  RoomPromptResponse,
  RoomType,
} from "./types";

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
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
  return (await res.json()) as T;
}

/** Stage 1: generate the whole-plan axonometric overview. Returns an image URL. */
export async function requestOverview(
  planDataUrl: string,
  brief: DesignBrief,
): Promise<string> {
  const data = await postJson<GenerateImageResponse>("/api/overview", {
    plan: planDataUrl,
    brief,
  });
  return data.image;
}

/** Stage 3a: auto-write the interior prompt for a cropped room. */
export async function requestRoomPrompt(
  roomDataUrl: string,
  brief: DesignBrief,
  roomType: RoomType,
): Promise<string> {
  const data = await postJson<RoomPromptResponse>("/api/room", {
    action: "write",
    room: roomDataUrl,
    brief,
    roomType,
  });
  return data.prompt;
}

/** Stage 3b: render a photorealistic interior from a (possibly edited) prompt. */
export async function requestRoomRender(
  roomDataUrl: string,
  prompt: string,
  variation: number,
): Promise<string> {
  const data = await postJson<GenerateImageResponse>("/api/room", {
    action: "render",
    room: roomDataUrl,
    prompt,
    variation,
  });
  return data.image;
}
