/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Image generations can be large base64 payloads; allow bigger request bodies
  // on Server Actions / route handlers if needed.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

module.exports = nextConfig;
