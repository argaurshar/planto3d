import { proxiedImageUrl } from "./imageProxy";

/**
 * Download an image to the user's device. Generated images are remote (kie.ai)
 * URLs without CORS, so a plain <a download> is ignored and a direct fetch is
 * blocked — fetch the bytes through a CORS-enabled image proxy and download the
 * blob. If even that fails, fall back to opening the image in a new tab.
 */
export async function downloadImage(url: string, filename: string): Promise<void> {
  // data: URLs (e.g. a local crop) can be downloaded directly.
  if (url.startsWith("data:")) {
    triggerDownload(url, filename);
    return;
  }
  try {
    const res = await fetch(proxiedImageUrl(url), { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    triggerDownload(objUrl, filename);
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
