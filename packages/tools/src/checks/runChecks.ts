/**
 * Runs every routine check once, sequentially (a slow hospital DB should not
 * get seven parallel scans), and turns each outcome into a stored-friendly
 * result. A check that fails does not stop the others: its own row says why.
 */
import type { CheckResult } from "@simha/shared";
import { Cause, Duration, Effect, Exit } from "effect";
import { KhanzaRead } from "../khanza/KhanzaRead.ts";
import { ROUTINE_CHECKS } from "./definitions.ts";

/** A check query is read-only and indexed by the schema; 30 s is generous. */
const CHECK_TIMEOUT = Duration.seconds(30);

export interface RoutineCheckReport {
  readonly checks: ReadonlyArray<CheckResult>;
  readonly masalah: number;
  readonly gagal: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

const errorText = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.findErrorOption(cause);
  if (failure._tag === "Some") {
    const error = failure.value;
    if (Cause.isTimeoutError(error)) return `Cek melewati batas waktu ${Duration.toMillis(CHECK_TIMEOUT) / 1000} detik.`;
    if (error instanceof Error) return error.message;
    return String(error);
  }
  return "Cek gagal dijalankan.";
};

export const runRoutineChecks: Effect.Effect<RoutineCheckReport, never, KhanzaRead> = Effect.gen(function* () {
  const startedAt = new Date();
  const started = performance.now();

  const checks = yield* Effect.forEach(
    ROUTINE_CHECKS,
    (check) =>
      Effect.gen(function* () {
        const at = performance.now();
        const exit = yield* check.run.pipe(Effect.timeout(CHECK_TIMEOUT), Effect.exit);
        const durationMs = Math.round(performance.now() - at);
        if (Exit.isSuccess(exit)) {
          return {
            id: check.id,
            title: check.title,
            severity: check.severity,
            description: check.description,
            advice: check.advice,
            status: exit.value.total > 0 ? ("masalah" as const) : ("ok" as const),
            count: exit.value.total,
            sample: exit.value.sample,
            error: null,
            durationMs,
          };
        }
        return {
          id: check.id,
          title: check.title,
          severity: check.severity,
          description: check.description,
          advice: check.advice,
          status: "gagal" as const,
          count: 0,
          sample: [],
          error: errorText(exit.cause),
          durationMs,
        };
      }),
    { concurrency: 1 },
  );

  return {
    checks: [...checks],
    masalah: checks.filter((check) => check.status === "masalah").length,
    gagal: checks.filter((check) => check.status === "gagal").length,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
  };
});
