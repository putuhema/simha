/**
 * Runs one scenario through the real agent loop and scores it. The LLM and
 * the database are whatever the caller's layer provides (real provider + test
 * DB in `pnpm eval`, a scripted client in tests), so this file has no I/O of
 * its own beyond the agent.
 */
import type { AgentEvent, RenderBlock } from "@simha/shared";
import { Cause, Effect, Stream } from "effect";
import { Agent } from "../agent/Agent.ts";
import { scoreScenario, type ScenarioResult } from "./score.ts";
import type { Scenario } from "./scenarios.ts";
import { evalUser } from "./users.ts";

export const runScenario = (scenario: Scenario): Effect.Effect<ScenarioResult, never, Agent> =>
  Effect.gen(function* () {
    const agent = yield* Agent;
    const events: Array<AgentEvent> = [];
    let streamError: string | null = null;
    const started = performance.now();

    yield* agent.run({ question: scenario.question, mode: scenario.mode, user: evalUser(scenario.user) }).pipe(
      Stream.runForEach((event) => {
        events.push(event);
        return Effect.void;
      }),
      Effect.catchCause((cause) => {
        // Interrupts are how a closed SSE stream ends; they are still a fail.
        streamError = Cause.hasInterruptsOnly(cause) ? "Run dihentikan." : Cause.pretty(cause);
        return Effect.void;
      }),
    );

    const tools: Array<string> = [];
    const attempted: Array<string> = [];
    const blocks: Array<RenderBlock> = [];
    let text = "";
    let steps = 0;
    let runError: string | null = streamError;
    let finished = false;

    for (const event of events) {
      switch (event._tag) {
        case "text_delta":
          text += event.text;
          break;
        case "tool_started":
          attempted.push(event.name);
          break;
        case "tool_finished":
          if (event.ok) tools.push(event.name);
          break;
        case "render":
          blocks.push(event.block);
          break;
        case "error":
          runError = event.message;
          break;
        case "done":
          finished = true;
          steps = event.steps;
          if (event.text !== "") text = event.text;
          break;
        default:
          break;
      }
    }

    if (!finished && runError === null) runError = "Run berhenti tanpa jawaban akhir.";
    return scoreScenario(scenario, {
      status: finished && runError === null ? "ok" : "error",
      error: runError,
      text,
      tools,
      attempted,
      blocks,
      steps,
      durationMs: Math.round(performance.now() - started),
    });
  });
