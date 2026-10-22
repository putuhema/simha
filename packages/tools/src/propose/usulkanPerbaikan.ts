import { Effect, Schema } from "effect";
import { CurrentSession, CurrentToolCall } from "../khanza/current-tool-call.ts";
import { FIX_ALLOW_LIST } from "../fixes/guard.ts";
import { MAX_FIX_ROWS, planFix } from "../fixes/plan.ts";
import { defineTool } from "../tool.ts";

const allowList = Object.entries(FIX_ALLOW_LIST)
  .map(([table, ops]) => `${table} (${ops.join("/").toUpperCase()})`)
  .join(", ");

const Param = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);

export const usulkanPerbaikan = defineTool({
  name: "usulkanPerbaikan",
  kind: "propose",
  description:
    "Propose a data fix as ONE SQL statement. It is NOT executed: it is checked, the affected rows are " +
    "previewed, and it is saved as a pending fix that IT staff must approve in the app. Use it after you " +
    "have diagnosed the problem with the read tools. Rules: one UPDATE, INSERT or DELETE on one of these " +
    `tables: ${allowList}. UPDATE/DELETE need a WHERE that selects exactly the rows to change (at most ` +
    `${MAX_FIX_ROWS}); no JOIN, subquery, ORDER BY, LIMIT or comments; UPDATE must not change primary-key ` +
    "columns. INSERT needs an explicit column list and literal primary-key values. Put values in `params` " +
    "with `?` placeholders. If the check fails, read the message, fix the SQL and try again.",
  parameters: Schema.Struct({
    judul: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)).annotate({
      description: "Short title, e.g. 'Tutup kamar lama MEL-02 pasien 2026/10/21/000002'.",
    }),
    sql: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(5_000)).annotate({
      description: "One UPDATE, INSERT or DELETE statement with ? placeholders.",
    }),
    params: Schema.optionalKey(
      Schema.Array(Param).annotate({ description: "Values for the ? placeholders, in order." }),
    ),
    alasan: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2_000)).annotate({
      description: "Why this fixes the problem, based on what you found in the data.",
    }),
  }),
  output: Schema.Struct({
    fixId: Schema.String,
    status: Schema.String,
    tabel: Schema.String,
    jenis: Schema.String,
    barisTerdampak: Schema.Number,
    sql: Schema.String,
    pratinjau: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    catatan: Schema.String,
  }),
  handler: Effect.fn("usulkanPerbaikan")(function* (params) {
    const fix = yield* planFix(
      "usulkanPerbaikan",
      { title: params.judul, reason: params.alasan, sql: params.sql, params: params.params ?? [] },
      { runId: yield* CurrentSession, toolCallId: yield* CurrentToolCall, createdBy: "ai" },
    );
    return {
      fixId: fix.id,
      status: "menunggu_persetujuan",
      tabel: fix.table,
      jenis: fix.kind.toUpperCase(),
      barisTerdampak: fix.expectedRows,
      sql: fix.sql,
      pratinjau: fix.preview,
      catatan:
        `Perbaikan BELUM dijalankan. Akan mengubah ${fix.expectedRows} baris setelah disetujui oleh petugas IT ` +
        "di aplikasi. Sampaikan ringkasan perbaikan ini kepada pengguna.",
    };
  }),
});
