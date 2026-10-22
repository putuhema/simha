import { describe, expect, it } from "vitest";
import { isLauncher } from "./khanza.ts";
import { parseEnv } from "./server.ts";
import { normalizeServerUrl } from "./settings.ts";

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
});
