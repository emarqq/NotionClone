import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Node environment: everything under test here is server-side or pure
    // (serializers, provider contract, SQL, the shell hook). No jsdom needed —
    // add a `environment: "jsdom"` project later if React components get tests.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The DB suite talks to a disposable Postgres container and must not run
    // concurrently with itself; the rest are pure and parallel-safe.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    // Mirror the "@/*" -> repo-root alias from tsconfig.json so tests import
    // modules by the same specifier the app uses.
    alias: {
      "@": path.resolve(__dirname, "."),
      // The LLM providers and lib/db/* start with `import "server-only"`, whose
      // default entrypoint throws by design outside a React Server Component.
      // Point it at the package's OWN empty.js — the exact stub Next resolves
      // to under the "react-server" condition — so server modules are testable
      // in Node without weakening the guard in the app build.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
