import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Ensure Turbopack treats the monorepo root (with bun.lockb) as the project root.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },

  // Static export for Cloudflare Pages
  output: isProd ? "export" : undefined,

  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },

  // Trailing slashes for better static hosting
  trailingSlash: isProd,

  // Proxy API in dev to avoid CORS/port issues.
  async rewrites() {
    if (isProd) return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:3001/health",
      },
    ];
  },
};

export default nextConfig;
