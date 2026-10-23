/**
 * The AI's own notebook. It records a durable fact about this hospital that
 * the next question should reuse: a local code, a column that behaves
 * differently, a rule the staff always want applied.
 *
 * Nothing here touches Khanza. A note is active immediately but unverified,
 * so an admin can review or turn it off on the knowledge page. Patient data is
 * rejected: knowledge is about the hospital, not about one visit.
 */
import { Effect, Schema } from "effect";
import { CurrentActor, CurrentSession } from "../khanza/current-tool-call.ts";
import { ToolError } from "../errors.ts";
import { defineTool } from "../tool.ts";
import { KnowledgeStore } from "./KnowledgeStore.ts";
import { personalReason } from "./search.ts";

const MAX_NOTE = 1_000;

export const catatPengetahuan = defineTool({
  name: "catatPengetahuan",
  kind: "read",
  description:
    "Record a durable fact about this hospital for future questions: a local code, a column that differs from standard " +
    "Khanza, a rule staff always want applied, or how a report should be interpreted. Use it only when the fact will " +
    "help a later question, not for one patient's data. Never include a no_rawat, RM, NIK, SEP or phone number. The " +
    "note is active immediately but marked unverified; an admin can review it. Do not use it to change data or to " +
    "answer the current question instead of the data tools.",
  parameters: Schema.Struct({
    catatan: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_NOTE)).annotate({
      description: "One or two sentences, in Indonesian, e.g. 'Pasien BPJS memakai penjab kd_pj = BPJ; umum = A09.'",
    }),
    judul: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))).annotate({
      description: "Short label for the knowledge page, e.g. 'Kode penjamin BPJS'.",
    }),
  }),
  output: Schema.Struct({
    id: Schema.String,
    pesan: Schema.String,
  }),
  handler: Effect.fn("catatPengetahuan")(function* ({ catatan, judul }) {
    const text = catatan.trim();
    const reason = personalReason(text);
    if (reason !== null) {
      return yield* Effect.fail(
        new ToolError({
          tool: "catatPengetahuan",
          message: `Catatan tidak disimpan karena ${reason}. Simpan aturan umum, bukan data satu pasien.`,
        }),
      );
    }
    const store = yield* KnowledgeStore;
    const actor = yield* CurrentActor;
    const runId = yield* CurrentSession;
    const item = yield* store.add({
      kind: "note",
      source: "ai",
      text,
      ...(judul !== undefined && judul.trim() !== "" ? { title: judul.trim() } : {}),
      verified: false,
      createdBy: actor,
      runId,
    });
    return {
      id: item.id,
      pesan: "Catatan disimpan dan akan dipakai untuk pertanyaan berikutnya. Admin masih bisa meninjau atau mematikannya.",
    };
  }),
});
