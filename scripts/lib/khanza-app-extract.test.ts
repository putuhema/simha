import { describe, expect, it } from "vitest";
import { buildIndex, parseFormTitle } from "./khanza-app-extract.ts";

describe("parseFormTitle", () => {
  it("reads the visible TitledBorder title", () => {
    const java = `
      internalFrame1.setBorder(javax.swing.BorderFactory.createTitledBorder(
        javax.swing.BorderFactory.createLineBorder(new java.awt.Color(240, 245, 235)),
        "::[ Data Resume Medis Pasien Rawat Inap ]::"));
    `;
    expect(parseFormTitle(java, "RMDataResumePasienRanap")).toBe("Data Resume Medis Pasien Rawat Inap");
  });

  it("ignores the NetBeans About Program placeholder", () => {
    const java = `setTitle("::[ About Program ]::");`;
    expect(parseFormTitle(java, "DlgBerkasRawat")).toBe("Dlg Berkas Rawat");
  });
});

describe("buildIndex", () => {
  it("uses the menu label when a form has no visible title", () => {
    const index = buildIndex({
      root: "/src",
      commit: "abc1234",
      generatedAt: "2026-10-23T00:00:00.000Z",
      tableNames: ["berkas_digital_perawatan"],
      titles: ["[M] Olah Data Rekam Medis Pasien"],
      groupNames: { M: "Rekam Medis" },
      entries: [
        { group: 0, button: "btnBerkas", label: "Berkas Digital Perawatan", labelled: true, rights: [], form: "DlgBerkasRawat" },
      ],
      toolbar: [],
      forms: new Map([
        [
          "DlgBerkasRawat",
          {
            file: "src/laporan/DlgBerkasRawat.java",
            package: "laporan",
            tables: { read: ["berkas_digital_perawatan"], write: [] },
            rights: [],
            actions: [],
            title: "Dlg Berkas Rawat",
            popup: [],
          },
        ],
      ]),
    });

    expect(index.forms.DlgBerkasRawat?.menus).toEqual(["M/Berkas Digital Perawatan"]);
    expect(index.forms.DlgBerkasRawat?.title).toBe("Berkas Digital Perawatan");
  });
});
