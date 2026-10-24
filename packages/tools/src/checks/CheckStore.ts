/**
 * Routine-check history in the audit SQLite DB (`check_runs`, `check_results`).
 *
 * One row per run and one row per check, with the definition copied in. The
 * newest 30 runs are kept; older ones are pruned in the same transaction, so a
 * scheduled check running for years does not grow the audit DB without bound.
 */
import type { CheckHit, CheckResult, CheckRun, CheckRunSummary, CheckSeverity, CheckStatus, CheckTrigger } from "@simha/shared";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";

/** How many runs stay in the database. The page shows the newest few. */
export const KEEP_CHECK_RUNS = 30;
const HISTORY_LIMIT = 20;

export interface NewCheckRun {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly trigger: CheckTrigger;
  readonly actor: string | null;
  readonly status: "ok" | "gagal";
  readonly error: string | null;
  readonly durationMs: number;
  readonly checks: ReadonlyArray<CheckResult>;
  readonly masalah: number;
  readonly gagal: number;
}

interface RunRow {
  readonly id: string;
  readonly started_at: string;
  readonly finished_at: string;
  readonly trigger: CheckTrigger;
  readonly actor: string | null;
  readonly status: "ok" | "gagal";
  readonly error: string | null;
  readonly duration_ms: number;
  readonly masalah: number;
  readonly gagal: number;
}

interface ResultRow {
  readonly check_id: string;
  readonly title: string;
  readonly severity: CheckSeverity;
  readonly description: string;
  readonly advice: string;
  readonly status: CheckStatus;
  readonly count: number;
  readonly sample_json: string;
  readonly error: string | null;
  readonly duration_ms: number;
}

const parseSample = (json: string): ReadonlyArray<CheckHit> => {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? (value as ReadonlyArray<CheckHit>) : [];
  } catch {
    return [];
  }
};

const toSummary = (row: RunRow): CheckRunSummary => ({
  id: row.id,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  trigger: row.trigger,
  actor: row.actor,
  status: row.status,
  masalah: row.masalah,
  gagal: row.gagal,
  durationMs: row.duration_ms,
});

const toResult = (row: ResultRow): CheckResult => ({
  id: row.check_id,
  title: row.title,
  severity: row.severity,
  description: row.description,
  advice: row.advice,
  status: row.status,
  count: row.count,
  sample: parseSample(row.sample_json),
  error: row.error,
  durationMs: row.duration_ms,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const save = (run: NewCheckRun) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO check_runs ${sql.insert({
            id: run.id,
            started_at: run.startedAt,
            finished_at: run.finishedAt,
            trigger: run.trigger,
            actor: run.actor,
            status: run.status,
            error: run.error,
            duration_ms: run.durationMs,
            masalah: run.masalah,
            gagal: run.gagal,
          })}`;
          for (const check of run.checks) {
            yield* sql`INSERT INTO check_results ${sql.insert({
              run_id: run.id,
              check_id: check.id,
              title: check.title,
              severity: check.severity,
              description: check.description,
              advice: check.advice,
              status: check.status,
              count: check.count,
              sample_json: JSON.stringify(check.sample),
              error: check.error,
              duration_ms: check.durationMs,
            })}`;
          }
          const kept = yield* sql<{ id: string }>`
            SELECT id FROM check_runs ORDER BY started_at DESC, id DESC LIMIT ${KEEP_CHECK_RUNS}`;
          const ids = kept.map((row) => row.id);
          if (ids.length > 0) {
            yield* sql`DELETE FROM check_results WHERE run_id NOT IN ${sql.in(ids)}`;
            yield* sql`DELETE FROM check_runs WHERE id NOT IN ${sql.in(ids)}`;
          }
        }),
      )
      .pipe(Effect.orDie);

  const latest = () =>
    Effect.gen(function* () {
      const [row] = yield* sql<RunRow>`
        SELECT id, started_at, finished_at, trigger, actor, status, error, duration_ms, masalah, gagal
        FROM check_runs ORDER BY started_at DESC, id DESC LIMIT 1`;
      if (row === undefined) return null;
      const results = yield* sql<ResultRow>`
        SELECT check_id, title, severity, description, advice, status, count, sample_json, error, duration_ms
        FROM check_results WHERE run_id = ${row.id} ORDER BY id`;
      return {
        ...toSummary(row),
        error: row.error,
        checks: results.map(toResult),
      } satisfies CheckRun;
    }).pipe(Effect.orDie);

  const history = () =>
    sql<RunRow>`
      SELECT id, started_at, finished_at, trigger, actor, status, error, duration_ms, masalah, gagal
      FROM check_runs ORDER BY started_at DESC, id DESC LIMIT ${HISTORY_LIMIT}`.pipe(
      Effect.map((rows) => rows.map(toSummary)),
      Effect.orDie,
    );

  return { save, latest, history };
});

export class CheckStore extends Context.Service<CheckStore, Effect.Success<typeof make>>()("simha/CheckStore") {}

/** Needs the audit DB's SqlClient. */
export const CheckStoreLive = Layer.effect(CheckStore, make);
