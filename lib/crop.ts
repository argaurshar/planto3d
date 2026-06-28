// Client-side helpers for selecting and cropping a rectangular region of the
// plan image. A rect is stored in NATURAL image pixel coordinates so the crop
// is full-resolution regardless of how the image is scaled on screen.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalize a rect drawn from any two corners into positive width/height. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Clamp a rect to the bounds of an image of the given natural size. */
export function clampRect(rect: Rect, naturalWidth: number, naturalHeight: number): Rect {
  const x = Math.max(0, Math.min(rect.x, naturalWidth));
  const y = Math.max(0, Math.min(rect.y, naturalHeight));
  return {
    x,
    y,
    width: Math.min(rect.width, naturalWidth - x),
    height: Math.min(rect.height, naturalHeight - y),
  };
}

/**
 * Crop `rect` (in natural pixels) out of a source image and return a PNG data
 * URL. Loads the source from a data URL so it works fully client-side.
 */
export async function cropToDataUrl(source: string, rect: Rect): Promise<string> {
  const { img, revoke } = await loadImage(source);
  try {
    const safe = clampRect(rect, img.naturalWidth, img.naturalHeight);
    const w = Math.max(1, Math.round(safe.width));
    const h = Math.max(1, Math.round(safe.height));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D canvas context.");

    ctx.drawImage(img, Math.round(safe.x), Math.round(safe.y), w, h, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  } finally {
    revoke();
  }
}

/**
 * Load an image for cropping. data: URLs load directly; remote http(s) URLs
 * (e.g. the generated overview) are fetched to a blob first and loaded via an
 * object URL, so drawing them to a canvas does NOT taint it (which would block
 * toDataURL). Returns a `revoke` to free any object URL after use.
 */
async function loadImage(
  src: string,
): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  let objectUrl: string | null = null;
  let imgSrc = src;
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) {
      throw new Error(
        "Couldn't load the overview image to crop (the image host blocked it).",
      );
    }
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);
    imgSrc = objectUrl;
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to load image for cropping."));
    el.src = imgSrc;
  });
  return { img, revoke: () => objectUrl && URL.revokeObjectURL(objectUrl) };
}
