import { describe, expect, it } from "vitest";
import { containsWords } from "./common.ts";
import { roomNote } from "./statusKamar.ts";

describe("containsWords", () => {
  it("matches all words in order", () => {
    expect(containsWords("  budi   santoso ")).toBe("%budi%santoso%");
  });

  it("escapes LIKE wildcards typed by the user", () => {
    expect(containsWords("100%")).toBe("%100\\%%");
    expect(containsWords("budi_h")).toBe("%budi\\_h%");
    expect(containsWords("a\\b")).toBe("%a\\\\b%");
  });
});

describe("roomNote", () => {
  it("flags a room marked ISI with nobody in it", () => {
    expect(roomNote({ status: "ISI", pasien_aktif: 0 })).toMatch(/tidak ada pasien aktif/);
  });

  it("flags a free room that has an active patient", () => {
    expect(roomNote({ status: "KOSONG", pasien_aktif: 1 })).toMatch(/ada 1 pasien aktif/);
  });

  it("is quiet when status and patients agree", () => {
    expect(roomNote({ status: "ISI", pasien_aktif: 1 })).toBeNull();
    expect(roomNote({ status: "KOSONG", pasien_aktif: 0 })).toBeNull();
  });
});
