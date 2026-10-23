/**
 * The app map and its search need no database: index.json + flows/ are static
 * files generated from the Khanza source. These tests pin the parsing and the
 * synonym behaviour that the agent relies on.
 */
import { describe, expect, it } from "vitest";
import { AppDocs, makeAppDocs, parseAppIndex, parseFlowDoc, parseSynonyms } from "../src/app/AppDocs.ts";
import { cariAplikasiKhanza } from "../src/app/cariAplikasiKhanza.ts";
import { searchApp } from "../src/app/search.ts";
import { defaultRegistry } from "../src/registry.ts";
import { Effect } from "effect";

const index = {
  source: { commit: "abc1234", generatedAt: "2026-10-23T00:00:00.000Z", root: "/src/simrsmt" },
  groups: [
    {
      letter: "A",
      name: "Registrasi & Billing",
      title: "[A] Registrasi, Tagihan & Billing",
      entries: [
        { label: "Registrasi", button: "btnRegistrasi", rights: ["registrasi"], form: "DlgReg" },
        { label: "Rawat Inap", button: "btnKamarInap", rights: ["kamar_inap", "billing_ranap"], form: "DlgKamarInap" },
        { label: "Resep Pulang", button: "btnResepPulang", rights: ["resep_pulang"], form: "DlgResepPulang" },
      ],
    },
    {
      letter: "L",
      name: "Bridging BPJS",
      title: "[L] Bridging BPJS",
      entries: [{ label: "Data Bridging SEP VClaim", button: "btnSEP", rights: ["bpjs_sep"], form: null }],
    },
    {
      letter: "M",
      name: "Rekam Medis",
      title: "[M] Rekam Medis",
      entries: [
        { label: "Resume Pasien Ranap", button: "btnResume", rights: ["data_resume_pasien"], form: "RMDataResumePasienRanap" },
        { label: "Berkas Digital Perawatan", button: "btnBerkas", rights: ["berkas_digital"], form: "DlgBerkasRawat" },
      ],
    },
  ],
  toolbar: [{ label: "Rawat Inap", form: "DlgKamarInap", button: "btnToolKamnap" }],
  forms: {
    DlgReg: {
      title: "Data Registrasi Pasien",
      file: "src/simrskhanza/DlgReg.java",
      package: "simrskhanza",
      menus: ["A/Registrasi"],
      rights: ["registrasi"],
      actions: ["Simpan", "Hapus", "Cetak"],
      popup: [],
      tables: { read: ["pasien", "penjab"], write: ["reg_periksa"] },
    },
    DlgKamarInap: {
      title: "Daftar Pasien Rawat Inap",
      file: "src/simrskhanza/DlgKamarInap.java",
      package: "simrskhanza",
      menus: ["A/Rawat Inap"],
      rights: ["kamar_inap"],
      actions: ["Masuk", "Pindah", "Pulang"],
      popup: [
        { path: "Billing/Pembayaran Pasien", form: null },
        { path: "Obat → Input Resep Pulang", form: null },
      ],
      tables: { read: ["kamar", "bangsal"], write: ["kamar_inap"] },
    },
    DlgBerkasRawat: {
      title: "::[ About Program ]::",
      file: "src/laporan/DlgBerkasRawat.java",
      package: "laporan",
      menus: ["M/Berkas Digital Perawatan"],
      rights: ["berkas_digital"],
      actions: ["Simpan", "Keluar"],
      popup: [],
      tables: { read: ["berkas_digital_perawatan"], write: [] },
    },
  },
  rights: {
    kamar_inap: { menus: ["A/Rawat Inap"], forms: ["DlgKamarInap"] },
    billing_ranap: { menus: ["A/Rawat Inap"], forms: ["DlgKamarInap"] },
    berkas_digital: { menus: ["M/Berkas Digital Perawatan"], forms: ["DlgBerkasRawat"] },
  },
};

const flow = `\`\`\`json meta
{
  "id": "rawat-inap",
  "title": "Rawat inap: permintaan sampai pulang",
  "keywords": ["rawat inap", "resume", "pulang", "kamar"],
  "menus": ["A/Rawat Inap", "M/Resume Pasien Ranap"],
  "forms": ["DlgKamarInap", "RMDataResumePasienRanap"]
}
\`\`\`

# Rawat inap: permintaan sampai pulang

Pasien masuk ranap dan pulang.

## Steps

### 5. Resume medis
- **Menu:** M/Resume Pasien Ranap
- **Form:** RMDataResumePasienRanap
- **Tabel:** resume_pasien_ranap

### 6. Pulang
- **Menu:** A/Rawat Inap
`;

const synonyms = [
  {
    terms: ["pindah kamar", "mutasi kamar"],
    menus: ["A/Rawat Inap"],
    forms: ["DlgKamarInap"],
    tables: ["kamar_inap"],
    note: "Tutup baris kamar_inap lama dengan stts_pulang 'Pindah Kamar'.",
  },
  {
    terms: ["resep"],
    menus: ["A/Resep Pulang"],
    forms: ["DlgResepPulang"],
    tables: [],
    note: "Resep pulang.",
  },
];

const docs = makeAppDocs(JSON.stringify(index), [{ name: "rawat-inap.md", text: flow }], synonyms);

describe("parseAppIndex", () => {
  it("flattens groups into menu paths", () => {
    const parsed = parseAppIndex(JSON.stringify(index), "/src");
    expect(parsed.menus.map((m) => m.path)).toContain("A/Rawat Inap");
    expect(parsed.forms.find((f) => f.name === "DlgKamarInap")?.tables.write).toEqual(["kamar_inap"]);
    expect(parsed.toolbar[0]?.label).toBe("Rawat Inap");
    expect(parsed.source.commit).toBe("abc1234");
  });

  it("returns an empty map for broken JSON", () => {
    expect(parseAppIndex("{not json", "/src").menus).toEqual([]);
  });
});

describe("parseFlowDoc", () => {
  it("reads the meta block and the steps", () => {
    const parsed = parseFlowDoc(flow, "docs/khanza-app/flows/rawat-inap.md");
    expect(parsed?.id).toBe("rawat-inap");
    expect(parsed?.steps[0]?.title).toBe("Resume medis");
    expect(parsed?.steps[0]?.menu).toBe("M/Resume Pasien Ranap");
    expect(parsed?.steps[0]?.tables).toBe("resume_pasien_ranap");
  });

  it("parses the synonym file and drops entries without terms", () => {
    const parsed = parseSynonyms(JSON.stringify([{ terms: ["pindah kamar"], note: "x" }, { note: "y" }]));
    expect(parsed).toHaveLength(1);
  });
});

describe("searchApp", () => {
  it("finds a menu by its label", () => {
    const found = searchApp(docs, "registrasi");
    expect(found.menus[0]?.path).toBe("A/Registrasi");
  });

  it("uses synonyms for words that are not menu labels", () => {
    const found = searchApp(docs, "pindah kamar", "semua", docs.synonyms);
    expect(found.menus.some((m) => m.path === "A/Rawat Inap")).toBe(true);
    expect(found.forms.some((f) => f.name === "DlgKamarInap")).toBe(true);
    expect(found.synonyms[0]?.note).toContain("stts_pulang");
  });

  it("does not let SEP match resep", () => {
    const found = searchApp(docs, "SEP", "menu", docs.synonyms);
    expect(found.menus.map((m) => m.path)).toEqual(["L/Data Bridging SEP VClaim"]);
    expect(found.synonyms).toHaveLength(0);
  });

  it("finds flows and their steps", () => {
    const found = searchApp(docs, "resume", "alur");
    expect(found.flows[0]?.id).toBe("rawat-inap");
    expect(found.flows[0]?.steps[0]?.form).toBe("RMDataResumePasienRanap");
  });

  it("filters by scope", () => {
    const found = searchApp(docs, "kamar_inap", "hak");
    expect(found.menus).toHaveLength(0);
    expect(found.rights[0]?.name).toBe("kamar_inap");
  });

  it("returns nothing for an unknown word", () => {
    const found = searchApp(docs, "zzzqqq");
    expect(found.menus).toHaveLength(0);
    expect(found.flows).toHaveLength(0);
  });
});

describe("cariAplikasiKhanza", () => {
  it("is registered for the agent", () => {
    expect(defaultRegistry.get("cariAplikasiKhanza")).toBe(cariAplikasiKhanza);
  });

  it("answers with a menu path, a form and the source commit", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "pindah kamar" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.menu.some((menu) => menu.path === "A/Rawat Inap")).toBe(true);
    expect(result.menu[0]?.grup).toBe("Registrasi & Billing");
    expect(result.form[0]?.judul).toBe("Daftar Pasien Rawat Inap");
    expect(result.form.some((form) => form.nama === "DlgKamarInap")).toBe(true);
    expect(result.tombol).toContain("Pindah");
    expect(result.tombolCocok).toContain("Pindah");
    expect(result.petunjuk).toContain("daftar bernomor");
    // A how-to answer stays short: the data note only comes back for a diagnostic question.
    expect(result.catatan).toEqual([]);
    expect(result.sumber).toContain("abc1234");
  });

  it("finds a form by a button inside it", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "tombol pindah", bagian: "form" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.form[0]?.nama).toBe("DlgKamarInap");
    expect(result.tombol).toContain("Pindah");
    expect(result.tombolCocok).toContain("Pindah");
  });

  it("adds the data note for a diagnostic question", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "kenapa pindah kamar gagal" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.catatan.join(" ")).toContain("kamar_inap");
    expect(result.hak.map((right) => right.hak)).toContain("kamar_inap");
  });

  it("answers a right-click action with its full path", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "cara cek billing rawat inap" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.pintasan[0]?.aksi).toBe("Billing/Pembayaran Pasien");
    expect(result.pintasan[0]?.jalur).toBe("Rawat Inap → klik kanan → Billing/Pembayaran Pasien");
  });

  it("answers a table question with the forms that write it", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "form apa yang mengisi kamar_inap" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.tabel[0]?.nama).toBe("kamar_inap");
    expect(result.tabel[0]?.tulis).toContain("Daftar Pasien Rawat Inap");
    expect(result.form[0]?.nama).toBe("DlgKamarInap");
    expect(result.form[0]?.tulis).toContain("kamar_inap");
    // A table question is not answered with right-click shortcuts.
    expect(result.pintasan).toEqual([]);
    expect(result.menu[0]?.path).toBe("A/Rawat Inap");
  });

  it("filters forms by table when asked for a table", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "kamar_inap", bagian: "tabel" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.form.length).toBeGreaterThan(0);
    expect(result.form.every((form) => form.tulis.includes("kamar_inap"))).toBe(true);
    expect(result.form[0]?.nama).toBe("DlgKamarInap");
  });

  it("returns the rights that gate the menu named in the question", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "hak apa yang membuat menu rawat inap tidak muncul" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.menu[0]?.path).toBe("A/Rawat Inap");
    expect(result.hak.map((right) => right.hak)).toEqual(expect.arrayContaining(["kamar_inap", "billing_ranap"]));
    expect(result.pintasan).toEqual([]);
  });

  it("falls back to the menu label for a form without its own header", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "berkas digital" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.form[0]?.nama).toBe("DlgBerkasRawat");
    expect(result.form[0]?.judul).toBe("Berkas Digital Perawatan");
  });

  it("says so when the map does not cover the word", async () => {
    const result = await Effect.runPromise(
      cariAplikasiKhanza
        .handler({ kataKunci: "zzzqqq" })
        .pipe(Effect.provideService(AppDocs, docs)),
    );
    expect(result.menu).toHaveLength(0);
    expect(result.catatan.join(" ")).toContain("Tidak ada di peta aplikasi");
  });
});
