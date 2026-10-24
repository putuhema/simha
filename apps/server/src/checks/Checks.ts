/**
 * Routine data checks (M5.2): run every read-only check against Khanza and
 * store the report in the audit DB.
 *
 * The checks themselves live in @simha/tools (`ROUTINE_CHECKS`); this service
 * adds identity (who ran it, why), the run status and persistence. It never
 * changes Khanza.
 */
import type { CheckReport, CheckRun, CheckTrigger } from "@simha/shared";
import { CheckStore, KhanzaRead, runRoutineChecks, type NewCheckRun } from "@simha/tools";
import { Context, Effect, Layer } from "effect";

export interface ChecksService {
  /** Runs every check, stores the report, returns it. */
  readonly run: (trigger: CheckTrigger, actor: string | null) => Effect.Effect<CheckRun>;
  /** The newest report and the run history. */
  readonly report: Effect.Effect<CheckReport>;
}

const make = Effect.gen(function* () {
  const store = yield* CheckStore;
  const read = yield* KhanzaRead;

  const run = (trigger: CheckTrigger, actor: string | null) =>
    Effect.gen(function* () {
      const outcome = yield* runRoutineChecks.pipe(Effect.provideService(KhanzaRead, read));
      // A run is "gagal" only when no check could run at all; one broken query
      // in an otherwise working run is reported per check, not as a dead run.
      const allFailed = outcome.checks.length > 0 && outcome.checks.every((check) => check.status === "gagal");
      const firstError = outcome.checks.find((check) => check.error !== null)?.error ?? null;
      const saved: NewCheckRun = {
        id: crypto.randomUUID(),
        startedAt: outcome.startedAt,
        finishedAt: outcome.finishedAt,
        trigger,
        actor,
        status: allFailed ? "gagal" : "ok",
        error: allFailed ? (firstError ?? "Semua pemeriksaan gagal dijalankan.") : null,
        durationMs: outcome.durationMs,
        checks: outcome.checks,
        masalah: outcome.masalah,
        gagal: outcome.gagal,
      };
      yield* store.save(saved);
      return { ...saved, checks: [...outcome.checks] } satisfies CheckRun;
    }).pipe(Effect.orDie);

  const report = Effect.all({ latest: store.latest(), history: store.history() }).pipe(Effect.orDie);

  return { run, report } satisfies ChecksService;
});

export class Checks extends Context.Service<Checks, ChecksService>()("simha/Checks") {}

/** Needs the audit DB (CheckStore) and the read-only Khanza pool. */
export const ChecksLive = Layer.effect(Checks, make);
