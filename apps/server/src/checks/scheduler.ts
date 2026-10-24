/**
 * The scheduled side of M5.2: run the routine checks shortly after boot and
 * then every CHECKS_INTERVAL_MINUTES (default 6 hours). CHECKS_INTERVAL_MINUTES=0
 * pauses the timer; the Pemeriksaan page can still run them by hand.
 *
 * A failed run is written to the audit DB with status "gagal" when possible;
 * a failure to even store it is logged and the timer keeps going, so a short
 * Khanza outage does not take the server down.
 */
import { Cause, Duration, Effect, Layer } from "effect";
import { ChecksSettings } from "../config.ts";
import { Checks } from "./Checks.ts";

export const ChecksSchedulerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ChecksSettings;
    if (settings.intervalMinutes === 0) return;
    const checks = yield* Checks;

    const once = (trigger: "startup" | "schedule") =>
      checks.run(trigger, null).pipe(
        Effect.catchCause((cause) => Effect.logWarning(`Pemeriksaan data (${trigger}) gagal: ${Cause.pretty(cause)}`)),
      );

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.seconds(settings.startupDelaySeconds));
        yield* once("startup");
        while (true) {
          yield* Effect.sleep(Duration.minutes(settings.intervalMinutes));
          yield* once("schedule");
        }
      }),
    );
  }),
);
