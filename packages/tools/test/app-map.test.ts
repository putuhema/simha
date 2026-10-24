/**
 * Guards the checked-in app map: every flow and synonym must point at a real
 * menu path, and every menu button must point at a form the map knows.
 * These are the invariants `cariAplikasiKhanza` relies on; the generator's
 * `--check` covers staleness of index.json itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AppDocs, loadAppDocs } from "../src/app/AppDocs.ts";
import { detailAplikasi } from "../src/app/detailAplikasi.ts";
import { searchApp } from "../src/app/search.ts";

const dir = NodePath.resolve(import.meta.dirname, "../../../docs/khanza-app");
const docs = await loadAppDocs(NodePath.join(dir, "index.json"), NodePath.resolve(import.meta.dirname, "../../.."));
const paths = new Set(docs.menus.map((menu) => menu.path));

/** The Khanza source the map is generated from; absent on most machines, so the check skips. */
const sourceRoot = NodePath.resolve(process.env["KHANZA_SRC_DIR"] ?? NodePath.join(homedir(), "work/simrsmt"));
const sourceCommit = (() => {
  if (!existsSync(sourceRoot)) return null;
  try {
    return execFileSync("git", ["-C", sourceRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
})();

describe("docs/khanza-app", () => {
  it("has the 20 menu groups and the full button list", () => {
    expect(new Set(docs.menus.map((menu) => menu.groupLetter)).size).toBe(20);
    expect(docs.menus.length).toBeGreaterThan(1_000);
  });

  it("keeps the toolbar and the right-click menus", () => {
    expect(docs.toolbar.length).toBeGreaterThanOrEqual(5);
    expect(docs.toolbar.some((entry) => entry.form !== null)).toBe(true);
    const kamarInap = docs.forms.find((form) => form.name === "DlgKamarInap");
    expect(kamarInap?.popup.map((item) => item.path)).toContain("Billing/Pembayaran Pasien");
    expect(kamarInap?.tables.write).toContain("kamar_inap");
  });

  it("gives every form a readable dialog title", () => {
    const broken = docs.forms.filter((form) => form.title.trim() === "" || /about program/i.test(form.title));
    expect(broken.map((form) => form.name)).toEqual([]);
    // Forms that leave NetBeans' placeholder get the menu label instead.
    expect(docs.forms.find((form) => form.name === "DlgBerkasRawat")?.title).toBe("Berkas Digital Perawatan");
  });

  it("points every menu button at a known form", () => {
    const missing = docs.menus.filter((menu) => menu.form !== null && !docs.forms.some((form) => form.name === menu.form));
    expect(missing.map((menu) => menu.path)).toEqual([]);
  });

  it("keeps every documented flow on real menu paths", () => {
    expect(docs.flows.length).toBeGreaterThanOrEqual(10);
    for (const flow of docs.flows) {
      expect(flow.steps.length).toBeGreaterThanOrEqual(3);
      for (const menu of flow.menus) expect(paths.has(menu), `${flow.id}: ${menu}`).toBe(true);
      for (const step of flow.steps) {
        if (step.menu === null) continue;
        for (const menu of step.menu.split(" / ")) expect(paths.has(menu), `${flow.id} step ${step.title}: ${menu}`).toBe(true);
      }
    }
  });

  it("keeps the synonyms on real menu paths and form names", () => {
    const forms = new Set(docs.forms.map((form) => form.name));
    for (const synonym of docs.synonyms) {
      for (const menu of synonym.menus) expect(paths.has(menu), `${synonym.terms[0]}: ${menu}`).toBe(true);
      for (const form of synonym.forms) expect(forms.has(form), `${synonym.terms[0]}: ${form}`).toBe(true);
    }
  });

  it("gives every flow step the prose the agent answers from", () => {
    // `detailAplikasi` returns `does` as the step's answer; a step without it
    // would fall back to its title, which is the guessing this guard prevents.
    for (const flow of docs.flows) {
      for (const step of flow.steps) expect(step.does, `${flow.id} / ${step.title}`).toBeTruthy();
    }
  });

  it.skipIf(sourceCommit === null)("was generated from the current Khanza source commit", () => {
    // Re-run `pnpm extract-khanza-app` after a Khanza update: a stale map answers
    // about a menu that may have moved, and nothing at runtime can tell.
    expect(docs.source.commit).toBe(sourceCommit);
  });
});

describe("searchApp on the real map", () => {
  it("matches an affixed word to the label it was built from", () => {
    // "meminta" and "Permintaan" share the root "minta": no synonym entry involved.
    const found = searchApp(docs, "meminta rawat inap", "menu");
    expect(found.menus.some((menu) => menu.path === "A/Permintaan Rawat Inap")).toBe(true);
  });

  it("reaches a synonym through another affix", () => {
    // "perpindahan" is not in synonyms.json; the entry is "pindah kamar".
    const found = searchApp(docs, "perpindahan kamar", "semua", docs.synonyms);
    expect(found.menus.some((menu) => menu.path === "A/Rawat Inap")).toBe(true);
    expect(found.forms.some((form) => form.name === "DlgKamarInap")).toBe(true);
  });
});

/** Runs detailAplikasi against the checked-in map. */
const detailOnMap = (jenis: "alur" | "form" | "menu" | "hak", id: string, cari?: string) =>
  Effect.runPromise(
    detailAplikasi.handler({ jenis, id, ...(cari === undefined ? {} : { cari }) }).pipe(Effect.provideService(AppDocs, docs)),
  );

describe("detailAplikasi on the real map", () => {
  it("returns every step of a flow with what it does, not just its title", async () => {
    const result = await detailOnMap("alur", "rawat-inap");
    expect(result.ditemukan).toBe(true);
    expect(result.alur?.langkah).toHaveLength(7);
    const move = result.alur?.langkah.find((step) => step.judul.startsWith("Move the patient"));
    expect(move?.tujuan).toContain("four modes");
    expect(move?.hak).toBe("`kamar_inap`.");
    expect(move?.tabel).toContain("kamar_inap");
    expect(move?.dialog).toBe("Daftar Pasien Rawat Inap");
    // The intro explains the shared no_rawat, which the answer needs for "alurnya".
    expect(result.alur?.ringkasan).toContain("no_rawat");
  });

  it("returns a form's buttons, actions and tables, bounded for a giant menu", async () => {
    const result = await detailOnMap("form", "DlgKamarInap");
    const form = docs.forms.find((candidate) => candidate.name === "DlgKamarInap");
    expect(result.form?.aksi).toEqual([...(form?.actions ?? [])]);
    // 216 right-click entries: the first 30 are shown and the cut is announced.
    expect(result.form?.pintasan).toHaveLength(30);
    expect(result.form?.pintasan[0]?.langkah.length).toBeGreaterThan(0);
    expect(result.catatan.join(" ")).toContain("30 pertama ditampilkan");
  });

  it("narrows a giant form with a keyword instead of dumping it", async () => {
    const result = await detailOnMap("form", "DlgKamarInap", "resep pulang");
    expect(result.form?.pintasan.length).toBeGreaterThan(0);
    expect(result.form?.pintasan.every((item) => /resep pulang/i.test(`${item.aksi} ${item.jalur}`))).toBe(true);
    expect(result.catatan.join(" ")).not.toContain("ditampilkan");
    const billing = await detailOnMap("form", "DlgKamarInap", "billing");
    expect(billing.form?.pintasan.map((item) => item.aksi)).toContain("Billing/Pembayaran Pasien");
  });

  it("marks a cut table list instead of hiding the rest", async () => {
    const result = await detailOnMap("form", "RMRiwayatPerawatan");
    expect(result.form?.baca).toHaveLength(41);
    expect(result.form?.baca.at(-1)).toMatch(/^\+\d+$/);
  });

  it("answers a menu and an access right with the same wording as search", async () => {
    const menu = await detailOnMap("menu", "A/Rawat Inap");
    expect(menu.menu?.jalur).toBe("Registrasi & Billing → Rawat Inap");
    expect(menu.menu?.dialog).toBe("Daftar Pasien Rawat Inap");
    // 216 entries, cut at 30 for the menu door as well.
    expect(menu.menu?.pintasan).toHaveLength(31);
    expect(menu.menu?.pintasan.at(-1)).toMatch(/^\+\d+$/);
    const billing = await detailOnMap("menu", "A/Rawat Inap", "billing");
    expect(billing.menu?.pintasan).toContain("Billing/Pembayaran Pasien");

    const right = await detailOnMap("hak", "kamar_inap");
    expect(right.hak?.menu).toContain("Registrasi & Billing → Rawat Inap");
    expect(right.hak?.form).toContain("Daftar Pasien Rawat Inap");
  });
});
