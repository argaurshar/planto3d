"use client";

import { useState } from "react";
import { downloadImage } from "@/lib/download";

interface Props {
  url: string;
  filename: string;
  label?: string;
  className?: string;
}

/** Small button that downloads a (possibly remote) image to the device. */
export default function DownloadButton({ url, filename, label = "Download", className }: Props) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await downloadImage(url, filename);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={className ?? "btn-outline px-3 py-1.5 text-xs"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {busy ? "Saving…" : label}
    </button>
  );
}
