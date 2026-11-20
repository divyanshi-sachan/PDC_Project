import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: ["**/*.live.test.ts", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "live",
          include: ["packages/*/src/**/*.live.test.ts", "apps/*/src/**/*.live.test.ts"],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
