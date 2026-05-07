import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "src",
    include: ["e2e/**/*.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
