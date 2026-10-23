import type { AgentEvent } from "@simrs/shared";
import { Stream } from "effect";
import { HttpServerResponse } from "effect/http";

const encoder = new TextEncoder();

/** Comment line every 15 s, so a proxy or phone network does not drop a quiet stream while a tool runs. */
const KEEP_ALIVE = encoder.encode(": keep-alive\n\n");

/** One Server-Sent Event: `event: <_tag>` and the event as JSON. */
const encodeEvent = (event: AgentEvent): string => `event: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`;

/** Streams agent events as text/event-stream, with a keep-alive comment while the agent is busy. */
export const sseResponse = (events: Stream.Stream<AgentEvent>) =>
  HttpServerResponse.stream(
    Stream.mergeLeft(
      events.pipe(Stream.map((event) => encoder.encode(encodeEvent(event)))),
      // Comments are ignored by the browser/readEventStream, but keep the connection warm.
      Stream.tick("15 seconds").pipe(Stream.map(() => KEEP_ALIVE)),
    ),
    {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
    },
  );
