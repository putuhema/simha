import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests of the built UI against the e2e server: real API, agent and
 * fix executor on the throwaway synthetic test DB, with a scripted AI.
 * Run `pnpm --filter @simha/web build` first (the `e2e` script does).
 */
const PORT = Number(process.env["E2E_PORT"] ?? 8799);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", locale: "id-ID", timezoneId: "Asia/Makassar" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "node --disable-warning=ExperimentalWarning ../server/test/e2e-server.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
