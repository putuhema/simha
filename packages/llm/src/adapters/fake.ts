/**
 * Scripted adapter for tests and demos: no network, no API key.
 *
 * Each call to `chat` plays the next scripted turn. A turn is either a list
 * of events, a function of the request (e.g. to answer from the last tool
 * result), or a provider failure. When the script runs out, the model says
 * it is done.
 */
import { Stream } from "effect";
import { LlmError, type LlmClientService, type LlmInfo } from "../LlmClient.ts";
import type { ChatRequest, LlmEvent, ToolCall } from "../types.ts";

export type FakeTurn =
  | ReadonlyArray<LlmEvent>
  | ((request: ChatRequest) => ReadonlyArray<LlmEvent>)
  /** The provider call fails with this message. */
  | { readonly fail: string };

/** Unique across turns: a real provider never repeats a tool call id in one conversation. */
let callSeq = 0;

/** Builds a turn that writes `text` and calls the given tools. */
export const fakeTurn = (text: string, toolCalls: ReadonlyArray<Omit<ToolCall, "id"> & { id?: string }> = []): Array<LlmEvent> => {
  const calls = toolCalls.map((c) => ({ id: c.id ?? `fake_${callSeq++}`, name: c.name, args: c.args }));
  return [
    ...(text === "" ? [] : [{ type: "text_delta" as const, text }]),
    ...calls.map((call) => ({ type: "tool_call" as const, call })),
    { type: "done", stopReason: calls.length > 0 ? "tool_use" : "end_turn" },
  ];
};

export interface FakeClient extends LlmClientService {
  /** Every request the fake received, for assertions. */
  readonly requests: ReadonlyArray<ChatRequest>;
}

export const makeFakeClient = (script: ReadonlyArray<FakeTurn>, info?: Partial<LlmInfo>): FakeClient => {
  const requests: Array<ChatRequest> = [];
  let next = 0;
  return {
    info: { provider: "fake", adapter: "fake", model: "fake-model", maskPii: true, ...info },
    requests,
    chat: (request) =>
      Stream.suspend(() => {
        requests.push(request);
        const turn = script[next++];
        if (turn !== undefined && "fail" in turn) {
          return Stream.fail(new LlmError({ provider: "fake", message: turn.fail, retryable: false }));
        }
        const events = turn === undefined ? fakeTurn("Selesai.") : typeof turn === "function" ? turn(request) : turn;
        return Stream.fromIterable(events);
      }),
  };
};
