import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLauncher } from "./khanza.ts";
import { parseEnv } from "./server.ts";
import { migrateDataDir, normalizeServerUrl } from "./settings.ts";

describe("desktop helpers", () => {
  it("reads .env files like the server does", () => {
    const env = parseEnv(
      [
        "# comment",
        "KHANZA_DB_HOST=10.0.0.5",
        'KHANZA_DB_READ_PASS="p#ss word"',
        "LLM_MODEL=claude-opus-5-5   # trailing comment",
        "export SERVER_PORT=8787",
        "KHANZA_QUERY_TIMEOUT=10 seconds",
        "EMPTY=",
        "not a line",
      ].join("\r\n"),
    );
    expect(env).toEqual({
      KHANZA_DB_HOST: "10.0.0.5",
      KHANZA_DB_READ_PASS: "p#ss word",
      LLM_MODEL: "claude-opus-5-5",
      SERVER_PORT: "8787",
      KHANZA_QUERY_TIMEOUT: "10 seconds",
      EMPTY: "",
    });
  });

  it("accepts server addresses as people type them", () => {
    expect(normalizeServerUrl("10.0.0.5:8787")).toBe("http://10.0.0.5:8787");
    expect(normalizeServerUrl(" http://simrs.local:8787/tanya ")).toBe("http://simrs.local:8787");
    expect(normalizeServerUrl("https://harness.rs.id/")).toBe("https://harness.rs.id");
    expect(normalizeServerUrl("file:///C:/x")).toBeNull();
    expect(normalizeServerUrl("")).toBeNull();
  });

  it("only takes files that can start Khanza", () => {
    expect(isLauncher("C:\\SIMRS\\SIMRS-Khanza.BAT")).toBe(true);
    expect(isLauncher("C:\\SIMRS\\SIMRSKhanza.jar")).toBe(true);
    expect(isLauncher("C:\\SIMRS\\catatan.txt")).toBe(false);
  });

  it("moves the data folder from before the rename", () => {
    const root = mkdtempSync(path.join(tmpdir(), "simha-migrate-"));
    const previous = path.join(root, "SIMRS Harness");
    const next = path.join(root, "Simha");
    mkdirSync(previous);
    writeFileSync(path.join(previous, "settings.json"), '{"mode":"local"}');
    migrateDataDir(next, previous);
    expect(readFileSync(path.join(next, "settings.json"), "utf8")).toBe('{"mode":"local"}');
    expect(existsSync(previous)).toBe(false);
  });

  it("never overwrites a data folder that already exists", () => {
    const root = mkdtempSync(path.join(tmpdir(), "simha-migrate-"));
    const previous = path.join(root, "SIMRS Harness");
    const next = path.join(root, "Simha");
    mkdirSync(previous);
    mkdirSync(next);
    writeFileSync(path.join(next, "settings.json"), '{"mode":"remote"}');
    migrateDataDir(next, previous);
    expect(readFileSync(path.join(next, "settings.json"), "utf8")).toBe('{"mode":"remote"}');
    expect(existsSync(previous)).toBe(true);
  });
});

describe("Khanza bridge requests", () => {
  it("only passes known forms with a valid no. rawat / no. RM", async () => {
    const { parseTarget } = await import("./khanza-bridge.ts");
    expect(parseTarget({ form: "resume", value: "2024/02/21/000213" })).toEqual({ form: "resume", value: "2024/02/21/000213" });
    expect(parseTarget({ form: "riwayat", value: "018412" })).toEqual({ form: "riwayat", value: "018412" });
    expect(parseTarget({ form: "resume", value: "018412" })).toBeNull();
    expect(parseTarget({ form: "resume", value: "2024/02/21/000213\topen\tx" })).toBeNull();
    expect(parseTarget({ form: "hapus_data", value: "2024/02/21/000213" })).toBeNull();
    expect(parseTarget(null)).toBeNull();
  });
});
