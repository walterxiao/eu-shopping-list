import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Playwright and better-sqlite3 are server-only; exclude from client bundles.
  serverExternalPackages: ["playwright", "better-sqlite3"],
};

export default nextConfig;
