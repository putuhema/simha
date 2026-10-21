import type { AgentEvent } from "@simrs/shared";
import { Stream } from "effect";
import { HttpServerResponse } from "effect/http";

const encoder = new TextEncoder();

/** One Server-Sent Event: `event: <_tag>` and the event as JSON. */
const encodeEvent = (event: AgentEvent): string => `event: ${event._tag}\ndata: ${JSON.stringify(event)}\n\n`;

/** Streams agent events as text/event-stream. */
export const sseResponse = (events: Stream.Stream<AgentEvent>) =>
  HttpServerResponse.stream(
    events.pipe(Stream.map((event) => encoder.encode(encodeEvent(event)))),
    {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
    },
  );
