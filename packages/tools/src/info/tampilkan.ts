/**
 * Shows a stored query result in the chat as a table, chart, number or list.
 * The data comes from the database result (by queryId), never from the AI,
 * so the numbers on screen are exactly what the query returned.
 */
import { RenderBlock, RenderType } from "@simrs/shared";
import { Effect, Schema } from "effect";
import { ToolError } from "../errors.ts";
import { CurrentSession, CurrentToolCall } from "../khanza/current-tool-call.ts";
import { defineTool } from "../tool.ts";
import { buildBlock, RenderRejected } from "./render.ts";
import { ResultStore } from "./ResultStore.ts";

const NAME = "tampilkan";

const Column = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64));

export const tampilkan = defineTool({
  name: NAME,
  kind: "render",
  description:
    "Show the result of a jalankanQueryBaca call to the user, with the SQL that was used. Pick the type: " +
    "'stat' for one number (query returns exactly 1 row), 'bar' for comparing categories (top N, per poli), " +
    "'line' for a trend over time, 'pie' for shares of a whole (few categories), 'table' for detail rows, " +
    "'list' for a short list of names. Optional opsi: x = category/label column, y = value column(s), " +
    "kolom = columns to show in a table, satuan = unit (e.g. 'pasien', 'Rp'). Call it once per result you " +
    "want to show; do not repeat the rows in your text, just summarise them.",
  parameters: Schema.Struct({
    tipe: RenderType,
    judul: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)).annotate({
      description: "Title in Indonesian, e.g. '10 tindakan terbanyak di Poli Gigi, Oktober 2026'.",
    }),
    queryId: Schema.String.check(Schema.isNonEmpty()).annotate({ description: "queryId from jalankanQueryBaca." }),
    asumsi: Schema.optionalKey(
      Schema.String.check(Schema.isMaxLength(300)).annotate({
        description: "One line with the assumptions, e.g. 'bulan ini = 1–22 Okt 2026, hanya rawat jalan'.",
      }),
    ),
    opsi: Schema.optionalKey(
      Schema.Struct({
        x: Schema.optionalKey(Column),
        y: Schema.optionalKey(Schema.Array(Column)),
        kolom: Schema.optionalKey(Schema.Array(Column)),
        satuan: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(30))),
      }),
    ),
  }),
  output: Schema.Struct({ blockId: Schema.String, block: RenderBlock }),
  handler: Effect.fn(NAME)(function* (params) {
    const results = yield* ResultStore;
    const result = yield* results.getResult(params.queryId);
    if (result === undefined) {
      return yield* new ToolError({
        tool: NAME,
        message: `queryId ${params.queryId} tidak ditemukan. Jalankan jalankanQueryBaca dulu dan pakai queryId dari hasilnya.`,
      });
    }
    const block = yield* Effect.try({
      try: () => buildBlock(params, result),
      catch: (error) =>
        new ToolError({ tool: NAME, message: error instanceof RenderRejected ? error.message : String(error) }),
    });
    yield* results.saveBlock(block, { toolCallId: yield* CurrentToolCall, sessionId: yield* CurrentSession });
    return { blockId: block.id, block };
  }),
  forModel: ({ block }) => ({
    ditampilkan: true,
    blockId: block.id,
    tipe: block.tipe,
    jumlahBaris: block.baris.length,
    catatan: "Sudah tampil di layar pengguna beserta SQL-nya. Jangan ulangi isi tabel; beri ringkasan singkat.",
  }),
});
