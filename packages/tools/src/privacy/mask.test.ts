import { describe, expect, it } from "vitest";
import { maskPii, maskText } from "./mask.ts";

describe("maskPii", () => {
  it("masks NIK, phone, address and email columns by name", () => {
    expect(
      maskPii({
        no_rkm_medis: "000001",
        nm_pasien: "BUDI SANTOSO",
        no_ktp: "5171000000000001",
        no_tlp: "081300000001",
        notelep: "0361-123456",
        alamat: "JL. FIKTIF NO. 1",
        almt_pj: "JL. FIKTIF NO. 2",
        alamatpj: "JL. FIKTIF NO. 3",
        email: "budi@example.com",
      }),
    ).toEqual({
      no_rkm_medis: "000001",
      nm_pasien: "BUDI SANTOSO",
      no_ktp: "[NIK disamarkan]",
      no_tlp: "[telepon disamarkan]",
      notelep: "[telepon disamarkan]",
      alamat: "[alamat disamarkan]",
      almt_pj: "[alamat disamarkan]",
      alamatpj: "[alamat disamarkan]",
      email: "[email disamarkan]",
    });
  });

  it("walks nested arrays and objects and leaves numbers, nulls and empty values", () => {
    expect(maskPii({ rows: [{ alamat: null, no_tlp: "", n: 3, ok: true }] })).toEqual({
      rows: [{ alamat: null, no_tlp: "", n: 3, ok: true }],
    });
  });
});

describe("maskText", () => {
  it("masks NIK and phone numbers inside free text", () => {
    expect(maskText("NIK 5171000000000001, hp 0813-0000-0001 atau +6281300000002")).toBe(
      "NIK [NIK disamarkan], hp [telepon disamarkan] atau [telepon disamarkan]",
    );
  });

  it("keeps RM numbers, visit numbers, dates, SEP and BPJS card numbers", () => {
    const text = "RM 012345, no_rawat 2026/10/21/000123, tgl 2026-10-21, SEP 0001R0011026V000001, kartu 0000000000001";
    expect(maskText(text)).toBe(text);
  });
});
