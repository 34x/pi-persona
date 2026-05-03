import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["index.test.ts", "src/**/*.test.ts", "*.test.ts"],
  },
});
