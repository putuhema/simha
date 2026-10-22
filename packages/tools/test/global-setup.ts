/**
 * Vitest global setup: starts the throwaway Khanza test database (see
 * test-db.ts) and shares its connection info with the tests.
 */
import type { TestProject } from "vitest/node";
import { startTestDb } from "./test-db.ts";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { info, stop } = await startTestDb();
  if (info === null) {
    console.warn(
      "[tools] No test database: Khanza DB tests are skipped. " +
        "Run `docker compose up -d` and set KHANZA_TEST_DB_HOST=127.0.0.1 KHANZA_TEST_DB_PORT=3307 " +
        "KHANZA_TEST_DB_ADMIN_PASS=test, or install MariaDB locally.",
    );
  }
  project.provide("khanzaTestDb", info);
  return stop;
}
