import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /* config options here */
  // There's a stray /Users/erikmarquardt/package-lock.json outside this repo
  // that makes Next.js/Turbopack infer the wrong workspace root. Pin it
  // explicitly to this project directory to silence the warning.
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
