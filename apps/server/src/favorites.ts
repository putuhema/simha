/**
 * "Pertanyaan favorit": save the question and SQL behind a chat result, and
 * re-run it later without the AI. A re-run goes through the same tools as the
 * agent (select guard, read user, time limit, audit log), with its own
 * session id `favorite:<id>:<run>` in the audit log.
 */
import type { Favorite } from "@simha/shared";
import { jalankanQueryBaca, ResultStore, runTool, tampilkan } from "@simha/tools";
import { Effect } from "effect";

/** Builds a favorite from a block shown in the chat. Fails with a message for a 404. */
export const favoriteFromBlock = (blockId: string, createdBy: string, question?: string) =>
  Effect.gen(function* () {
    const results = yield* ResultStore;
    const stored = yield* results.getBlock(blockId);
    if (!stored) return yield* Effect.fail("Hasil yang mau disimpan tidak ditemukan.");
    const result = yield* results.getResult(stored.block.queryId);
    if (!result) return yield* Effect.fail("Query hasil ini tidak ditemukan.");
    const { block } = stored;
    return yield* results.createFavorite({
      question: question ?? stored.question ?? block.judul,
      judul: block.judul,
      sql: result.sqlOriginal,
      tipe: block.tipe,
      opsi: {
        ...(block.x !== null ? { x: block.x } : {}),
        ...(block.y.length > 0 ? { y: block.y } : {}),
        ...(block.tipe === "table" ? { kolom: block.kolom } : {}),
        ...(block.satuan !== null ? { satuan: block.satuan } : {}),
      },
      asumsi: block.asumsi,
      createdBy,
    });
  });

/** Runs a favorite's SQL again and builds its block. Fails with the reason (guard, SQL or render error). */
export const runFavorite = (favorite: Favorite) =>
  Effect.gen(function* () {
    const options = { sessionId: `favorite:${favorite.id}:${crypto.randomUUID()}` };
    const query = yield* runTool(jalankanQueryBaca, { sql: favorite.sql, alasan: `Favorit: ${favorite.question}`.slice(0, 500) }, options);
    const shown = yield* runTool(
      tampilkan,
      {
        tipe: favorite.tipe,
        judul: favorite.judul,
        queryId: query.queryId,
        opsi: favorite.opsi,
        ...(favorite.asumsi !== null ? { asumsi: favorite.asumsi } : {}),
      },
      options,
    );
    return shown.block;
  }).pipe(Effect.mapError((error) => error.message));
