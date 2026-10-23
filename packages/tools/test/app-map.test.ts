/**
 * Guards the checked-in app map: every flow and synonym must point at a real
 * menu path, and every menu button must point at a form the map knows.
 * These are the invariants `cariAplikasiKhanza` relies on; the generator's
 * `--check` covers staleness of index.json itself.
 */
import * as NodePath from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppDocs } from "../src/app/AppDocs.ts";

const dir = NodePath.resolve(import.meta.dirname, "../../../docs/khanza-app");
const docs = await loadAppDocs(NodePath.join(dir, "index.json"), NodePath.resolve(import.meta.dirname, "../../.."));
const paths = new Set(docs.menus.map((menu) => menu.path));

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
});
