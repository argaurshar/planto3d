// Load the user's plan — a JPEG/PNG/WebP image or a PDF — into one PNG/JPEG
// data URL the AI can read, plus its pixel size. PDFs are rendered with
// pdf.js (first page by default) at a resolution that keeps small dimension
// text legible. Browser only.

export interface PlanImage {
  /** Data URL of the plan, at most MAX_SIDE px on its long side. */
  src: string;
  width: number;
  height: number;
  name: string;
  /** Number of pages, for PDFs. */
  pages?: number;
  page?: number;
}

/** Long side sent to the AI: enough for printed dimensions, small enough to upload fast. */
const MAX_SIDE = 2400;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image could not be opened."));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}

/** Draw a source onto a white canvas no larger than MAX_SIDE and export it. */
function toDataUrl(source: CanvasImageSource, w: number, h: number): { src: string; width: number; height: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, 0, 0, cw, ch);
  // PNG keeps thin plan lines crisp; fall back to JPEG if it is huge.
  let src = c.toDataURL("image/png");
  if (src.length > 6_000_000) src = c.toDataURL("image/jpeg", 0.92);
  return { src, width: cw, height: ch };
}

export async function loadPlanFile(file: File, page = 1): Promise<PlanImage> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    if (!file.type.startsWith("image/")) throw new Error("Please choose a JPEG, PNG or PDF plan.");
    const img = await loadImage(await readAsDataUrl(file));
    return { ...toDataUrl(img, img.naturalWidth, img.naturalHeight), name: file.name };
  }
  // The legacy build carries polyfills: the modern one needs JS features
  // (Map.getOrInsertComputed) that most browsers do not ship yet.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const n = Math.min(Math.max(1, page), doc.numPages);
    const pg = await doc.getPage(n);
    const base = pg.getViewport({ scale: 1 });
    const scale = Math.min(4, MAX_SIDE / Math.max(base.width, base.height));
    const viewport = pg.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { ...toDataUrl(canvas, canvas.width, canvas.height), name: file.name, pages: doc.numPages, page: n };
  } finally {
    void doc.destroy();
  }
}

/** Crop a region (natural pixels) of a plan image into a new plan image. */
export async function cropPlan(plan: PlanImage, rect: { x: number; y: number; w: number; h: number }): Promise<PlanImage> {
  const img = await loadImage(plan.src);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(rect.w));
  c.height = Math.max(1, Math.round(rect.h));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
  return { ...toDataUrl(c, c.width, c.height), name: plan.name };
}
