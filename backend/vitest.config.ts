import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // Stubs the variables `@/env` requires, before any spec imports it.
    setupFiles: ["src/testEnv.ts"],
    globals: true,
  },
});
