import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "tools",
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
