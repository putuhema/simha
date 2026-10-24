import type { Permissions } from "@simha/shared";
import { ALL_PERMISSIONS } from "@simha/shared";
import { Context } from "effect";

/** Id of the tool call being run, so queries can be linked to it in the audit log. */
export const CurrentToolCall = Context.Reference<string | null>("simha/CurrentToolCall", {
  defaultValue: () => null,
});

/** Run (agent question, MCP session, CLI) the current tool call belongs to. */
export const CurrentSession = Context.Reference<string | null>("simha/CurrentSession", {
  defaultValue: () => null,
});

/** Username of the person the tool runs for (null for scripts), e.g. shown on generated documents. */
export const CurrentActor = Context.Reference<string | null>("simha/CurrentActor", {
  defaultValue: () => null,
});

/**
 * What the SIMRS account behind this tool call may do. Defaults to everything
 * for the CLI and scripts, which run with the operator's own database user;
 * the HTTP server and the agent always provide the logged-in user's snapshot.
 */
export const CurrentPermissions = Context.Reference<Permissions>("simha/CurrentPermissions", {
  defaultValue: () => ALL_PERMISSIONS,
});
