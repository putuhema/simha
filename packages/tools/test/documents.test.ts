/**
 * dokumenPasien against the synthetic test DB: the three documents contain the
 * right Khanza data, never NIK/phone/address, and are stored for viewing.
 */
import { describe, expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { dokumenPasien } from "../src/documents/dokumenPasien.ts";
import { ResultStore, ResultStoreLive } from "../src/info/ResultStore.ts";
import { runTool } from "../src/tool.ts";
import { readTestLayer, testDb } from "./helpers.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const make = (input: Record<string, string>) =>
  Effect.gen(function* () {
    const out = yield* runTool(dokumenPasien, input, { sessionId: "test", actor: "it-budi" });
    const stored = yield* (yield* ResultStore).getDocument(out.document.id);
    if (!stored) throw new Error("document not stored");
    return { ...out, html: stored.html };
  });

describe.skipIf(testDb === null)("dokumenPasien", () => {
  if (testDb === null) return;

  layer(ResultStoreLive.pipe(Layer.provideMerge(readTestLayer(testDb))), { excludeTestServices: true })((it) => {
    it.effect("CPPT has the SOAP notes with writers, vital signs, diagnoses and lab", () =>
      Effect.gen(function* () {
        const { document, html } = yield* make({ jenis: "cppt", noRawat: "2026/10/21/000002" });
        expect(document).toMatchObject({
          jenis: "cppt",
          judul: "CPPT / SOAP",
          subjek: "RM 000002 · SITI AMINAH · 2026/10/21/000002",
          ringkas: "3 catatan CPPT, 2 diagnosis, 2 hasil lab",
          dibuatOleh: "it-budi",
        });
        expect(html).toContain("RSUD FIKTIF SEHAT");
        expect(html).toContain("BAB cair 6x sejak kemarin, mual, lemas.");
        expect(html).toContain("<b>A09 – Diare dan gastroenteritis</b>");
        expect(html).toContain("E86 – Dehidrasi");
        expect(html).toMatch(/dr\. Andi Fiktif<\/b><br><span class="muted">Dokter/);
        expect(html).toMatch(/Ns\. Rina Fiktif<\/b><br><span class="muted">Perawat/);
        expect(html).toContain("TD 100/70 mmHg");
        expect(html).toMatch(/class="flag">12\.8</);
        // Oldest note first.
        expect(html.indexOf("BAB cair 6x")).toBeLessThan(html.indexOf("Tidak BAB cair"));
        for (const secret of ["5171000000000002", "081300000002", "JL. FIKTIF NO. 2"]) expect(html).not.toContain(secret);
      }),
    );

    it.effect("riwayat lists every visit with diagnoses, rooms, tindakan and drugs", () =>
      Effect.gen(function* () {
        const { document, html, data } = yield* make({ jenis: "riwayat", noRkmMedis: "000001" });
        expect(document.ringkas).toBe("3 kunjungan, 3 diagnosis");
        expect(html).toContain("K02.1 – Karies dentin");
        expect(html).toContain("A01.0 – Demam tifoid");
        expect(html).toContain("MEL-01");
        expect(html).toContain("Tambal Gigi");
        expect((data as { kunjungan: ReadonlyArray<{ noRawat: string }> }).kunjungan.map((v) => v.noRawat)).toEqual([
          "2026/10/20/000001",
          "2026/10/01/000003",
          "2026/09/15/000004",
        ]);
        expect(html).not.toContain("5171000000000001");
      }),
    );

    it.effect("resume uses the one written in Khanza, or makes a marked draft", () =>
      Effect.gen(function* () {
        const written = yield* make({ jenis: "resume", noRawat: "2026/09/15/000004" });
        expect(written.document).toMatchObject({ judul: "Resume medis", ringkas: "dari Khanza, dr. Andi Fiktif" });
        expect(written.html).toContain("Demam tifoid (A01.0)");
        expect(written.html).toContain("Sefiksim 2x200 mg");
        expect(written.html).not.toContain("draf</b>");

        const draft = yield* make({ jenis: "resume", noRawat: "2026/10/21/000002" });
        expect(draft.document.judul).toBe("Draf resume medis");
        expect(draft.html).toContain("Ini <b>draf</b>");
        expect(draft.html).toContain("BAB cair 6x sejak kemarin");
        expect(draft.html).toContain("Diare dan gastroenteritis (A09)");
        expect(draft.html).toContain("Paracetamol 500 mg × 6");
      }),
    );

    it.effect("explains what is missing", () =>
      Effect.gen(function* () {
        expect(message(yield* Effect.flip(runTool(dokumenPasien, { jenis: "riwayat" })))).toMatch(/butuh noRkmMedis/);
        expect(message(yield* Effect.flip(runTool(dokumenPasien, { jenis: "cppt" })))).toMatch(/butuh noRawat/);
        expect(message(yield* Effect.flip(runTool(dokumenPasien, { jenis: "cppt", noRawat: "2099/01/01/999999" })))).toMatch(
          /tidak ditemukan/,
        );
        expect(message(yield* Effect.flip(runTool(dokumenPasien, { jenis: "riwayat", noRkmMedis: "999999" })))).toMatch(
          /RM 999999 tidak ditemukan/,
        );
      }),
    );
  });
});
