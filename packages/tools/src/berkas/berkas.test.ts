import { describe, expect, it } from "vitest";
import { berkasContentType, berkasKindOf, safeRelativePath } from "./Berkas.ts";

describe("berkas paths", () => {
  it("accepts the relative paths Khanza stores", () => {
    expect(safeRelativePath("berkas/2026/10/21/000002-hasil-lab.pdf")).toBe("2026/10/21/000002-hasil-lab.pdf");
    expect(safeRelativePath("webapps\\berkas\\2026\\foto.png")).toBe("2026/foto.png");
    expect(safeRelativePath("2026/foto.png")).toBe("2026/foto.png");
  });

  it("rejects absolute, traversal and URL paths", () => {
    expect(safeRelativePath("/etc/passwd")).toBeNull();
    expect(safeRelativePath("\\\\server\\share\\a.png")).toBeNull();
    expect(safeRelativePath("../a.png")).toBeNull();
    expect(safeRelativePath("berkas/../../a.png")).toBeNull();
    expect(safeRelativePath("C:\\a.png")).toBeNull();
    expect(safeRelativePath("https://example.test/a.png")).toBeNull();
    expect(safeRelativePath("")).toBeNull();
  });

  it("classifies the files the card can preview", () => {
    expect(berkasKindOf("foto.PNG")).toBe("gambar");
    expect(berkasKindOf("hasil.pdf")).toBe("pdf");
    expect(berkasKindOf("surat.docx")).toBe("lainnya");
    expect(berkasContentType("foto.png")).toBe("image/png");
    expect(berkasContentType("hasil.pdf")).toBe("application/pdf");
    expect(berkasContentType("surat.docx")).toBe("application/octet-stream");
  });
});
