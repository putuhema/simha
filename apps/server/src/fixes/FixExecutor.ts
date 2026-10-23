/**
 * Runs approved fixes on Khanza and rolls them back. The only code that uses
 * the write pool.
 *
 * Apply (after a person clicks Approve):
 *   1. Record the approval in fix_events (audit DB) and mark the fix approved.
 *   2. Refuse to continue unless that approval row exists.
 *   3. In ONE write transaction:
 *      - re-check the statement with the guard,
 *      - lock the rows it will touch (SELECT ... FOR UPDATE) = before-image,
 *        and stop if their count differs from the preview,
 *      - run the statement and stop if the affected row count differs,
 *      - read the rows as they are now = after-image.
 *      Any stop rolls the whole transaction back.
 *   4. Save before/after images; mark applied (or failed).
 *
 * Rollback: only if the rows still match the after-image exactly, restore
 * the before-image in one transaction (UPDATE back, re-INSERT deleted rows,
 * DELETE inserted rows), again checking every row count.
 */
import {
  AuditLog,
  checkFix,
  FixStore,
  KhanzaWrite,
  selectByKeys,
  sqlLiteral as escape,
  type CheckedFix,
  type Fix,
  type FixParam,
  type Row,
} from "@simha/tools";
import { Context, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/sql/SqlError";

/** Why an approve / reject / rollback request was refused or failed. Shown to IT staff. */
export class FixActionError extends Schema.TaggedError<FixActionError>()("FixActionError", {
  status: Schema.Literals([404, 409, 422, 500]),
  message: Schema.String,
}) {}

/** A row-count check failed inside the transaction; it is rolled back. */
class RowCountMismatch extends Schema.TaggedError<RowCountMismatch>()("RowCountMismatch", {
  message: Schema.String,
}) {}

const quote = (identifier: string) => `\`${identifier.replaceAll("`", "``")}\``;

/** Runs the guard again on a stored statement; a rejection becomes a RowCountMismatch-style abort. */
const recheck = (fix: Fix) =>
  Effect.try({
    try: (): CheckedFix => checkFix(fix.sql, [], () => fix.primaryKey),
    catch: (e) =>
      new RowCountMismatch({ message: `Statement tidak lolos pemeriksaan ulang: ${e instanceof Error ? e.message : String(e)}` }),
  });

/** Fails when two counts differ; the message explains which step. */
const failWith = (status: FixActionError["status"], message: string) =>
  Effect.fail(new FixActionError({ status, message }));

const verifyCount = (step: string, expected: number, actual: number) =>
  expected === actual
    ? Effect.void
    : Effect.fail(
        new RowCountMismatch({
          message: `${step}: diharapkan ${expected} baris, ternyata ${actual}. Transaksi dibatalkan, tidak ada data yang berubah.`,
        }),
      );

const keyOf = (row: Row, primaryKey: ReadonlyArray<string>): Record<string, FixParam> =>
  Object.fromEntries(primaryKey.map((k) => [k, (row[k] ?? null) as FixParam]));

const sameRow = (a: Row, b: Row) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? null) === (b[k] ?? null));
};

const sqlErrorMessage = (e: SqlError) => {
  const cause = e.reason.cause;
  return cause instanceof Error ? cause.message : e.message;
};

const make = Effect.gen(function* () {
  const write = yield* KhanzaWrite;
  const store = yield* FixStore;
  const audit = yield* AuditLog;
  const { sql } = write;

  /** Runs one statement on the write pool inside the current transaction and logs it with the fix id. */
  const run = (fixId: string, text: string) =>
    Effect.gen(function* () {
      const started = performance.now();
      const result = yield* sql.unsafe(text).raw.pipe(
        Effect.tapError((e) =>
          audit.query({
            toolCallId: null,
            fixId,
            pool: "write",
            sql: text,
            params: [],
            rowCount: null,
            durationMs: performance.now() - started,
            error: sqlErrorMessage(e),
          }),
        ),
      );
      const rows = Array.isArray(result) ? (result as ReadonlyArray<Row>) : undefined;
      const affected = rows === undefined ? Number((result as { affectedRows?: number }).affectedRows ?? 0) : rows.length;
      yield* audit.query({
        toolCallId: null,
        fixId,
        pool: "write",
        sql: text,
        params: [],
        rowCount: affected,
        durationMs: performance.now() - started,
        error: null,
      });
      return { rows: rows ?? [], affected };
    });

  /** Steps 2-3 of apply. Fails with RowCountMismatch or SqlError; the transaction is then rolled back. */
  const execute = (fix: Fix) =>
    sql.withTransaction(
      Effect.gen(function* () {
        // Re-check: the stored statement must still pass the guard.
        const checked = yield* recheck(fix);
        if (checked.table !== fix.table || checked.kind !== fix.kind) {
          return yield* new RowCountMismatch({ message: "Statement tidak cocok dengan data perbaikan yang disimpan." });
        }

        if (checked.kind === "insert") {
          const existing = yield* run(fix.id, `${selectByKeys(fix.table, checked.insertedKeys)} FOR UPDATE`);
          yield* verifyCount("Cek baris yang akan ditambahkan belum ada", 0, existing.rows.length);
          const result = yield* run(fix.id, fix.sql);
          yield* verifyCount("Jumlah baris yang ditambahkan", fix.expectedRows, result.affected);
          const after = yield* run(fix.id, selectByKeys(fix.table, checked.insertedKeys));
          yield* verifyCount("Baris baru terbaca kembali", fix.expectedRows, after.rows.length);
          return { before: [] as ReadonlyArray<Row>, after: after.rows };
        }

        const before = yield* run(fix.id, `${checked.previewSql} FOR UPDATE`);
        yield* verifyCount("Jumlah baris saat disetujui dibanding pratinjau", fix.expectedRows, before.rows.length);
        const result = yield* run(fix.id, fix.sql);
        yield* verifyCount("Jumlah baris yang diubah", fix.expectedRows, result.affected);
        const keys = before.rows.map((r) => keyOf(r, fix.primaryKey));
        const after = yield* run(fix.id, selectByKeys(fix.table, keys));
        yield* verifyCount(
          checked.kind === "delete" ? "Baris yang dihapus masih ada" : "Baris yang diubah terbaca kembali",
          checked.kind === "delete" ? 0 : fix.expectedRows,
          after.rows.length,
        );
        return { before: before.rows, after: after.rows };
      }),
    );

  const load = (id: string) =>
    Effect.flatMap(store.get(id), (fix) => (fix ? Effect.succeed(fix) : failWith(404, "Perbaikan tidak ditemukan.")));

  /** Approve and apply a pending fix. */
  const approve = (id: string, actor: string) =>
    Effect.gen(function* () {
      const fix = yield* load(id);
      if (fix.status !== "pending") return yield* failWith(409, `Perbaikan berstatus ${fix.status}, tidak bisa disetujui.`);
      // 1. The approval row is written (and committed in SQLite) before anything touches Khanza.
      if (!(yield* store.transition(id, ["pending"], "approved"))) {
        return yield* failWith(409, "Perbaikan sudah diproses oleh orang lain.");
      }
      yield* store.addEvent(id, "approved", actor);
      return yield* applyApproved(id);
    });

  /** Step 2-4. Exported for tests that prove nothing runs without an approval row. */
  const applyApproved = (id: string) =>
    Effect.gen(function* () {
      const fix = yield* load(id);
      const approval = yield* store.approvalOf(id);
      if (fix.status !== "approved" || approval === undefined) {
        return yield* failWith(409, "Perbaikan belum disetujui; tidak ada yang dijalankan.");
      }
      const outcome = yield* execute(fix).pipe(
        Effect.map((images) => ({ ok: true as const, ...images })),
        Effect.catchTags({
          RowCountMismatch: (e) => Effect.succeed({ ok: false as const, error: e.message }),
          SqlError: (e) => Effect.succeed({ ok: false as const, error: `Database menolak perubahan: ${sqlErrorMessage(e)}` }),
        }),
      );
      if (outcome.ok) {
        yield* store.transition(id, ["approved"], "applied", { before: outcome.before, after: outcome.after, error: null });
        yield* store.addEvent(id, "applied", approval.actor, `${fix.expectedRows} baris diubah.`);
      } else {
        yield* store.transition(id, ["approved"], "failed", { error: outcome.error });
        yield* store.addEvent(id, "apply_failed", approval.actor, outcome.error);
      }
      return yield* load(id);
    });

  const reject = (id: string, actor: string, reason: string | undefined) =>
    Effect.gen(function* () {
      const fix = yield* load(id);
      if (fix.status !== "pending" || !(yield* store.transition(id, ["pending"], "rejected"))) {
        return yield* failWith(409, `Perbaikan berstatus ${fix.status}, tidak bisa ditolak.`);
      }
      yield* store.addEvent(id, "rejected", actor, reason ?? null);
      return yield* load(id);
    });

  /** Restores the before-image in one transaction, if the rows still look exactly like the after-image. */
  const undo = (fix: Fix) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const before = fix.before ?? [];
        const after = fix.after ?? [];
        const t = quote(fix.table);
        const where = (key: Record<string, FixParam>) =>
          Object.entries(key)
            .map(([c, v]) => `${quote(c)} <=> ${escape(v)}`)
            .join(" AND ");

        if (fix.kind === "update" || fix.kind === "insert") {
          const keys = after.map((r) => keyOf(r, fix.primaryKey));
          const current = yield* run(fix.id, `${selectByKeys(fix.table, keys)} FOR UPDATE`);
          yield* verifyCount("Baris hasil perbaikan masih ada", after.length, current.rows.length);
          for (const row of after) {
            const now = current.rows.find((c) => sameRow(keyOf(c, fix.primaryKey), keyOf(row, fix.primaryKey)));
            if (!now || !sameRow(now, row)) {
              return yield* new RowCountMismatch({
                message: `Baris ${JSON.stringify(keyOf(row, fix.primaryKey))} sudah berubah sejak perbaikan dijalankan; rollback dibatalkan agar perubahan baru tidak tertimpa.`,
              });
            }
          }
        }

        if (fix.kind === "update") {
          const changed = (yield* recheck(fix)).setColumns;
          for (const row of before) {
            const assignments = changed.map((c) => `${quote(c)} = ${escape((row[c] ?? null) as FixParam)}`).join(", ");
            const result = yield* run(fix.id, `UPDATE ${t} SET ${assignments} WHERE ${where(keyOf(row, fix.primaryKey))}`);
            yield* verifyCount("Baris dikembalikan", 1, result.affected);
          }
        } else if (fix.kind === "delete") {
          for (const row of before) {
            const columns = Object.keys(row);
            const values = columns.map((c) => escape((row[c] ?? null) as FixParam)).join(", ");
            const result = yield* run(fix.id, `INSERT INTO ${t} (${columns.map(quote).join(", ")}) VALUES (${values})`);
            yield* verifyCount("Baris yang dihapus dikembalikan", 1, result.affected);
          }
        } else {
          for (const row of after) {
            const result = yield* run(fix.id, `DELETE FROM ${t} WHERE ${where(keyOf(row, fix.primaryKey))}`);
            yield* verifyCount("Baris yang ditambahkan dihapus", 1, result.affected);
          }
        }
      }),
    );

  const rollback = (id: string, actor: string) =>
    Effect.gen(function* () {
      const fix = yield* load(id);
      if (fix.status !== "applied") return yield* failWith(409, `Perbaikan berstatus ${fix.status}, tidak bisa di-rollback.`);
      yield* store.addEvent(id, "rollback_requested", actor);
      const outcome = yield* undo(fix).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          RowCountMismatch: (e) => Effect.succeed({ ok: false as const, error: e.message }),
          SqlError: (e) => Effect.succeed({ ok: false as const, error: `Database menolak rollback: ${sqlErrorMessage(e)}` }),
        }),
      );
      if (!outcome.ok) {
        yield* store.addEvent(id, "rollback_failed", actor, outcome.error);
        return yield* failWith(422, outcome.error);
      }
      yield* store.transition(id, ["applied"], "rolled_back");
      yield* store.addEvent(id, "rolled_back", actor, `${fix.expectedRows} baris dikembalikan.`);
      return yield* load(id);
    });

  return { approve, applyApproved, reject, rollback };
});

export class FixExecutor extends Context.Service<FixExecutor, Effect.Success<typeof make>>()("simha/FixExecutor") {}

export const FixExecutorLive = Layer.effect(FixExecutor, make);
