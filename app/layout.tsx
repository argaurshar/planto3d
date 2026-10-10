import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voxa — room plan to exact 3D",
  description:
    "Upload a room plan (JPEG or PDF): get a true-scale 3D model, eye-level shots from the main door and behind the bed or sofa, edits by typing, photoreal renders and a Blender export.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
