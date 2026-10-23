/**
 * The hint that turns "Unknown column" into the name the model should have
 * used: without it the model guesses again, which costs a whole turn.
 */
import { describe, expect, it } from "vitest";
import { KhanzaQueryError } from "../errors.ts";
import { withHint } from "./jalankanQueryBaca.ts";

const columns = new Map<string, ReadonlyArray<string>>([
  ["kamar_inap", ["no_rawat", "kd_kamar", "tgl_masuk", "tgl_keluar", "stts_pulang"]],
]);

const syntax = (message: string) => new KhanzaQueryError({ kind: "syntax", message });

describe("withHint", () => {
  it("names the columns that look like the misspelt one", () => {
    const hinted = withHint(syntax("Unknown column 'tgl_msk' in 'field list'"), columns);
    expect(hinted.message).toContain("Unknown column 'tgl_msk'");
    expect(hinted.message).toContain("tgl_masuk");
  });

  it("ignores a table alias before the column", () => {
    const hinted = withHint(syntax("Unknown column 'ki.tgl_msk' in 'where clause'"), columns);
    expect(hinted.message).toContain("Petunjuk");
    expect(hinted.message).toContain("tgl_masuk");
  });

  it("points back to lihatSkema when nothing is close", () => {
    const hinted = withHint(syntax("Unknown column 'zzzqqq' in 'field list'"), columns);
    expect(hinted.message).toContain("lihatSkema");
    expect(hinted.message).not.toContain("Kolom yang mirip");
  });

  it("leaves other errors alone", () => {
    const timeout = new KhanzaQueryError({ kind: "timeout", message: "terlalu lama" });
    expect(withHint(timeout, columns)).toBe(timeout);
    const other = syntax("Table 'sik.foo' doesn't exist");
    expect(withHint(other, columns)).toBe(other);
  });
});
