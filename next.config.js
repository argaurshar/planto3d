/** @type {import('next').NextConfig} */

// STATIC_EXPORT=true builds a fully static site (for GitHub Pages). In that mode
// there are no server routes — generation runs in the browser (see lib/api.ts /
// lib/kieBrowser.ts). The default (server) build keeps the secure API routes.
const isStatic = process.env.STATIC_EXPORT === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

// The Blender renderer (blender-server/voxa_render.py) is imported as text so
// the download package and the render server run the very same script.
const withPythonSource = (config) => ({
  ...config,
  webpack: (wp) => {
    wp.module.rules.push({ test: /\.py$/, type: "asset/source" });
    return wp;
  },
});

const nextConfig = isStatic
  ? {
      reactStrictMode: true,
      output: "export",
      basePath: basePath || undefined,
      assetPrefix: basePath || undefined,
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {
      reactStrictMode: true,
      experimental: {
        // Image generations can be large base64 payloads.
        serverActions: { bodySizeLimit: "12mb" },
      },
    };

module.exports = withPythonSource(nextConfig);
