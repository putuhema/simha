/**
 * Resume drafts against the synthetic test DB: filled from Khanza data, or
 * from the resume already in Khanza; the AI's answers are checked against
 * Khanza's limits and choices; clinical text is masked for external AI.
 */
import { describe, expect, layer } from "@effect/vitest";
import { test } from "vitest";
import { Effect, Exit, Layer } from "effect";
import { dischargeFrom } from "../src/drafts/resumeDraft.ts";
import { buatDraftResume, isiDraft } from "../src/drafts/draftTools.ts";
import { ResultStore, ResultStoreLive } from "../src/info/ResultStore.ts";
import { maskPii } from "../src/privacy/mask.ts";
import { runTool } from "../src/tool.ts";
import { readTestLayer, testDb } from "./helpers.ts";

const ctx = { sessionId: "test", actor: "dr-andi" };

describe("dischargeFrom", () => {
  test("maps Khanza's discharge status to the resume's choices", () => {
    expect(dischargeFrom("Membaik")).toEqual({ cara_keluar: "Atas Izin Dokter", keadaan: "Membaik" });
    expect(dischargeFrom("APS")).toEqual({ cara_keluar: "Pulang Atas Permintaan Sendiri" });
    expect(dischargeFrom("Rujuk")).toEqual({ cara_keluar: "Pindah RS" });
    expect(dischargeFrom("-")).toEqual({});
  });
});

describe.skipIf(testDb === null)("resume drafts", () => {
  if (testDb === null) return;

  layer(ResultStoreLive.pipe(Layer.provideMerge(readTestLayer(testDb))), { excludeTestServices: true })((it) => {
    it.effect("fills what Khanza data shows and leaves the rest for the user", () =>
      Effect.gen(function* () {
        const { draft } = yield* runTool(buatDraftResume, { noRawat: "2026/10/21/000002" }, ctx);
        expect(draft).toMatchObject({ form: "resume_ranap", existing: false, subjek: "RM 000002 · SITI AMINAH · 2026/10/21/000002" });
        expect(draft.fields).toMatchObject({
          diagnosa_awal: "DIARE",
          diagnosa_utama: "Diare dan gastroenteritis",
          kd_diagnosa_utama: "A09",
          kd_diagnosa_sekunder: "E86",
          prosedur_utama: "Injection or infusion of electrolytes",
          kd_prosedur_utama: "99.18",
          keluhan_utama: "BAB cair 6x sejak kemarin, mual, lemas.",
        });
        expect(draft.fields["pemeriksaan_fisik"]).toContain("TD 100/70 mmHg");
        expect(draft.fields["obat_di_rs"]).toContain("Oralit (4)");
        expect(draft.fields["hasil_laborat"]).toContain("12.8");
        expect(draft.sources["kd_diagnosa_utama"]).toBe("data");
        expect(draft.fields["jalannya_penyakit"]).toBeUndefined();
        expect((yield* (yield* ResultStore).getDraft(draft.id))?.fields).toEqual(draft.fields);
      }),
    );

    it.effect("tells the AI what is missing, with clinical text masked for external providers", () =>
      Effect.gen(function* () {
        const { draft } = yield* runTool(buatDraftResume, { noRawat: "2026/10/21/000002" }, ctx);
        const forModel = maskPii(buatDraftResume.forModel!({ draft })) as {
          terisi: Record<string, string>;
          kosongWajib: ReadonlyArray<{ key: string }>;
          kosong: ReadonlyArray<{ key: string; pilihan?: ReadonlyArray<string> }>;
        };
        expect(forModel.kosongWajib.map((f) => f.key)).toEqual(["jalannya_penyakit"]);
        expect(forModel.kosong.find((f) => f.key === "dilanjutkan")?.pilihan).toContain("Kembali Ke RS");
        expect(forModel.terisi["keluhan_utama"]).toBe("[catatan klinis tidak dikirim ke AI]");
        expect(forModel.terisi["kd_diagnosa_utama"]).toBe("A09");
      }),
    );

    it.effect("starts from the resume already in Khanza", () =>
      Effect.gen(function* () {
        const { draft } = yield* runTool(buatDraftResume, { noRawat: "2026/09/15/000004" }, ctx);
        expect(draft.existing).toBe(true);
        expect(draft.fields["keluhan_utama"]).toBe("Demam 7 hari");
        expect(draft.sources["keluhan_utama"]).toBe("khanza");
      }),
    );

    it.effect("stores the user's answers, checked against Khanza's limits and choices", () =>
      Effect.gen(function* () {
        const { draft } = yield* runTool(buatDraftResume, { noRawat: "2026/10/21/000002" }, ctx);
        const answers = { jalannya_penyakit: "Rehidrasi IV, BAB membaik hari ke-2.", keadaan: "Membaik", kontrol: "2026-10-28 09:00" };
        const out = yield* runTool(isiDraft, { draftId: draft.id, isian: answers }, ctx);
        expect(out.draft.fields).toMatchObject(answers);
        expect(out.draft.sources["jalannya_penyakit"]).toBe("ai");

        for (const isian of [{ keadaan: "Baik sekali" }, { kontrol: "minggu depan" }, { diagnosa_awal: "x".repeat(101) }, { nama_pasien: "x" }]) {
          const exit = yield* Effect.exit(runTool(isiDraft, { draftId: draft.id, isian }, ctx));
          expect(Exit.isFailure(exit)).toBe(true);
        }
      }),
    );

    it.effect("refuses outpatient visits", () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(runTool(buatDraftResume, { noRawat: "2026/10/22/000005" }, ctx));
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );
  });
});
