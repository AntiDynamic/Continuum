import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["benchmarks/**", "node_modules/**", "dist/**"],
  },
});
