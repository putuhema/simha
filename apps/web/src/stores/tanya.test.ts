import type { AgentEvent } from "@simha/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunView } from "../lib/run.ts";
import { useTanya, type LiveAnswer } from "./tanya.ts";

const encoder = new TextEncoder();

const eventBlock = (value: AgentEvent) => `event: ${value._tag}\ndata: ${JSON.stringify(value)}\n\n`;

const respondWith = (events: ReadonlyArray<AgentEvent>) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of events) controller.enqueue(encoder.encode(eventBlock(value)));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const RUN_STARTED = { _tag: "run_started", runId: "r1", conversationId: "c1", provider: "uji", model: "model" } as const;
const DONE = { _tag: "done", runId: "r1", text: "Halo", stopReason: "end_turn", steps: 0 } as const;

describe("tanya store streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useTanya.getState().reset();
  });

  it("keeps token-level text out of the turns array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respondWith([RUN_STARTED, { _tag: "text_delta", text: "Ha" }, { _tag: "text_delta", text: "lo" }, DONE]),
      ),
    );

    const turnChanges: Array<ReadonlyArray<RunView>> = [];
    const liveChanges: Array<LiveAnswer | null> = [];
    const unsubscribe = useTanya.subscribe((state, previous) => {
      if (state.turns !== previous.turns) turnChanges.push(state.turns);
      if (state.live !== previous.live) liveChanges.push(state.live);
    });

    await useTanya.getState().ask("Siapa saya?");
    unsubscribe();

    // The initial turn, run_started, and done. The text deltas only reach `live`,
    // so a component that selects `turns` is not notified per token.
    expect(turnChanges).toHaveLength(3);
    expect(turnChanges[1]?.[0]).toMatchObject({ status: "running", text: "" });
    expect(liveChanges.map((live) => live?.text ?? null)).toEqual(["", "Ha", "Halo", null]);

    const state = useTanya.getState();
    expect(state.running).toBe(false);
    expect(state.live).toBeNull();
    expect(state.conversationId).toBe("c1");
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({ status: "done", text: "Halo" });
  });

  it("drops a run that finishes after the thread was reset", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate;
        return respondWith([RUN_STARTED, { _tag: "text_delta", text: "Halo" }, DONE]);
      }),
    );

    const asking = useTanya.getState().ask("Siapa saya?");
    expect(useTanya.getState().turns).toHaveLength(1);
    useTanya.getState().reset();
    release();
    await asking;

    expect(useTanya.getState().turns).toHaveLength(0);
    expect(useTanya.getState().conversationId).toBeNull();
    expect(useTanya.getState().live).toBeNull();
  });
});
