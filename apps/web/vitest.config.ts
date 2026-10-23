import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "web",
    // Unit tests only; e2e/ is run by Playwright (`pnpm --filter @simha/web e2e`).
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
