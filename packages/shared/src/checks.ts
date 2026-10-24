/**
 * Routine data checks (M5.2): the known, recurring data problems in Khanza that
 * Simha looks for on a schedule, and the report of one run.
 *
 * A check is read-only and explains itself: what it looks for, why the pattern
 * breaks Khanza, and what staff should do. A finding names the visit and the
 * patient so the page can open an investigation with one click.
 */
import { Schema } from "effect";

/** How bad a finding is when it is true. */
export const CheckSeverity = Schema.Literals(["kritis", "peringatan", "info"]);
export type CheckSeverity = typeof CheckSeverity.Type;

/** ok: nothing found; masalah: the pattern exists; gagal: the query itself failed. */
export const CheckStatus = Schema.Literals(["ok", "masalah", "gagal"]);
export type CheckStatus = typeof CheckStatus.Type;

/** schedule = the built-in timer, manual = "Jalankan sekarang", startup = first run after boot. */
export const CheckTrigger = Schema.Literals(["schedule", "manual", "startup"]);
export type CheckTrigger = typeof CheckTrigger.Type;

/** One row that shows the problem. Only the fields the page shows, never clinical text. */
export const CheckHit = Schema.Struct({
  /** no_rawat of the visit the finding belongs to, when it belongs to one. */
  noRawat: Schema.NullOr(Schema.String),
  noRm: Schema.NullOr(Schema.String),
  pasien: Schema.NullOr(Schema.String),
  /** One line a person can read: what is wrong here. */
  keterangan: Schema.String,
});
export type CheckHit = typeof CheckHit.Type;

/** One check in one run. The definition is copied in, so an old report stays readable. */
export const CheckResult = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  severity: CheckSeverity,
  description: Schema.String,
  advice: Schema.String,
  status: CheckStatus,
  /** Total hits, even when `sample` is capped. */
  count: Schema.Number,
  /** At most 20 hits; the page says when there are more. */
  sample: Schema.Array(CheckHit),
  /** Why the query failed, for status "gagal". */
  error: Schema.NullOr(Schema.String),
  durationMs: Schema.Number,
});
export type CheckResult = typeof CheckResult.Type;

/** One complete run of every check. */
export const CheckRun = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.String,
  trigger: CheckTrigger,
  actor: Schema.NullOr(Schema.String),
  /** ok when every check ran (even with findings); gagal when none could. */
  status: Schema.Literals(["ok", "gagal"]),
  error: Schema.NullOr(Schema.String),
  durationMs: Schema.Number,
  checks: Schema.Array(CheckResult),
  /** Checks with status "masalah". */
  masalah: Schema.Number,
  /** Checks with status "gagal". */
  gagal: Schema.Number,
});
export type CheckRun = typeof CheckRun.Type;

/** A past run without its findings, for the history list. */
export const CheckRunSummary = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.String,
  trigger: CheckTrigger,
  actor: Schema.NullOr(Schema.String),
  status: Schema.Literals(["ok", "gagal"]),
  masalah: Schema.Number,
  gagal: Schema.Number,
  durationMs: Schema.Number,
});
export type CheckRunSummary = typeof CheckRunSummary.Type;

/** GET /api/checks: the newest report and a short history. */
export const CheckReport = Schema.Struct({
  latest: Schema.NullOr(CheckRun),
  history: Schema.Array(CheckRunSummary),
});
export type CheckReport = typeof CheckReport.Type;
