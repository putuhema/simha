import { Context } from "effect";

/** Id of the tool call being run, so queries can be linked to it in the audit log. */
export const CurrentToolCall = Context.Reference<string | null>("simrs/CurrentToolCall", {
  defaultValue: () => null,
});
