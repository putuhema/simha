import { Context } from "effect";

/** Id of the tool call being run, so queries can be linked to it in the audit log. */
export const CurrentToolCall = Context.Reference<string | null>("simrs/CurrentToolCall", {
  defaultValue: () => null,
});

/** Run (agent question, MCP session, CLI) the current tool call belongs to. */
export const CurrentSession = Context.Reference<string | null>("simrs/CurrentSession", {
  defaultValue: () => null,
});
