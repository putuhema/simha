import { Duration } from "effect";
import { describe, expect, it } from "vitest";
import { detectServer, looksReadOnly, withStatementTimeout } from "./server.ts";

describe("detectServer", () => {
  it("recognises MariaDB and MySQL version strings", () => {
    expect(detectServer("12.1.2-MariaDB").flavor).toBe("mariadb");
    expect(detectServer("10.6.18-MariaDB-0ubuntu0.22.04.1").flavor).toBe("mariadb");
    expect(detectServer("8.0.36").flavor).toBe("mysql");
  });
});

describe("withStatementTimeout", () => {
  const ten = Duration.seconds(10);

  it("wraps MariaDB queries in SET STATEMENT", () => {
    expect(withStatementTimeout("  SELECT 1", detectServer("11.4.2-MariaDB"), ten)).toBe(
      "SET STATEMENT max_statement_time=10.000 FOR SELECT 1",
    );
    expect(withStatementTimeout("WITH x AS (SELECT 1) SELECT * FROM x", detectServer("11-MariaDB"), ten)).toBe(
      "SET STATEMENT max_statement_time=10.000 FOR WITH x AS (SELECT 1) SELECT * FROM x",
    );
  });

  it("adds the MAX_EXECUTION_TIME hint on MySQL", () => {
    expect(withStatementTimeout("select a from b", detectServer("8.0.36"), ten)).toBe(
      "SELECT /*+ MAX_EXECUTION_TIME(10000) */ a from b",
    );
  });
});

describe("looksReadOnly", () => {
  it("accepts SELECT and WITH", () => {
    expect(looksReadOnly("SELECT 1")).toBe(true);
    expect(looksReadOnly("\n  with x as (select 1) select * from x")).toBe(true);
  });

  it("rejects writes and multiple statements", () => {
    expect(looksReadOnly("UPDATE kamar SET status = 'KOSONG'")).toBe(false);
    expect(looksReadOnly("DELETE FROM kamar_inap")).toBe(false);
    expect(looksReadOnly("SELECT 1; DROP TABLE pasien")).toBe(false);
    expect(looksReadOnly("SELECTED")).toBe(false);
  });
});
