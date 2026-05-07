import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "src",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["e2e/**"],
  },
});
