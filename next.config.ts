import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // better-sqlite3 is a native module that must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
