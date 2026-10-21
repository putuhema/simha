import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "server",
    // Same throwaway Khanza test DB (synthetic data) as packages/tools.
    globalSetup: ["../../packages/tools/test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
