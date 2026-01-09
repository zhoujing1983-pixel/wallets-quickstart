import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  reactStrictMode: false,
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "sqlite-vec-darwin-arm64",
    "pdf-parse",
    "mammoth",
    "xlsx"
  ]
};

export default nextConfig;
