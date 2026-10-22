/**
 * HTTP API contracts shared by the server and the web UI.
 */
import { Schema } from "effect";

const NonEmpty = Schema.String.check(Schema.isNonEmpty());

// --- Tickets ---------------------------------------------------------------

export const TicketStatus = Schema.Literals(["open", "investigating", "diagnosed", "closed"]);
export type TicketStatus = typeof TicketStatus.Type;

export const CreateTicketRequest = Schema.Struct({
  nurseName: NonEmpty.check(Schema.isMaxLength(100)),
  unit: NonEmpty.check(Schema.isMaxLength(100)),
  complaint: NonEmpty.check(Schema.isMaxLength(5_000)),
});
export type CreateTicketRequest = typeof CreateTicketRequest.Type;

export const Ticket = Schema.Struct({
  id: Schema.String,
  nurseName: Schema.String,
  unit: Schema.String,
  complaint: Schema.String,
  status: TicketStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Ticket = typeof Ticket.Type;

/** Body of POST /tickets/:id/investigate. Empty starts the investigation; `question` asks a follow-up. */
export const InvestigateRequest = Schema.Struct({
  question: Schema.optionalKey(NonEmpty.check(Schema.isMaxLength(5_000))),
});
export type InvestigateRequest = typeof InvestigateRequest.Type;

// --- Tanya Data -------------------------------------------------------------

/** Body of POST /ask. Pass the `conversationId` from `run_started` to ask a follow-up in the same context. */
export const AskRequest = Schema.Struct({
  question: NonEmpty.check(Schema.isMaxLength(5_000)),
  conversationId: Schema.optionalKey(Schema.String),
});
export type AskRequest = typeof AskRequest.Type;

// --- Agent stream (Server-Sent Events) ---------------------------------------

/** First event: which run, conversation and AI model this is. */
export const RunStarted = Schema.TaggedStruct("run_started", {
  runId: Schema.String,
  conversationId: Schema.String,
  provider: Schema.String,
  model: Schema.String,
});

/** A piece of the AI's answer text. */
export const TextDelta = Schema.TaggedStruct("text_delta", { text: Schema.String });

/** The AI called a tool (one step in "Yang dicek AI"). */
export const ToolStarted = Schema.TaggedStruct("tool_started", {
  callId: Schema.String,
  name: Schema.String,
  args: Schema.Unknown,
});

/** Tool finished. `result` is the full (unmasked) result, for the UI only. */
export const ToolFinished = Schema.TaggedStruct("tool_finished", {
  callId: Schema.String,
  name: Schema.String,
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
  durationMs: Schema.Number,
});

/** Last event of a successful run. */
export const RunDone = Schema.TaggedStruct("done", {
  runId: Schema.String,
  text: Schema.String,
  stopReason: Schema.String,
  steps: Schema.Number,
});

/** Last event of a failed run. */
export const RunError = Schema.TaggedStruct("error", { message: Schema.String });

export const AgentEvent = Schema.Union([RunStarted, TextDelta, ToolStarted, ToolFinished, RunDone, RunError]);
export type AgentEvent = typeof AgentEvent.Type;

// --- Errors -------------------------------------------------------------------

/** JSON body of every 4xx/5xx response. */
export const ApiErrorBody = Schema.Struct({ error: Schema.String });
export type ApiErrorBody = typeof ApiErrorBody.Type;

// --- Fixes (proposal -> approval -> apply -> rollback) ------------------------

export const FixStatus = Schema.Literals(["pending", "approved", "applied", "failed", "rejected", "rolled_back"]);
export type FixStatus = typeof FixStatus.Type;

const DataRow = Schema.Record(Schema.String, Schema.Unknown);
const FixParam = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);

export const Fix = Schema.Struct({
  id: Schema.String,
  runId: Schema.NullOr(Schema.String),
  toolCallId: Schema.NullOr(Schema.String),
  ticketId: Schema.NullOr(Schema.String),
  title: Schema.String,
  reason: Schema.String,
  kind: Schema.Literals(["update", "insert", "delete"]),
  table: Schema.String,
  sqlOriginal: Schema.String,
  params: Schema.Array(FixParam),
  /** The exact statement that runs on approval. */
  sql: Schema.String,
  /** "akan mengubah N baris". */
  expectedRows: Schema.Number,
  primaryKey: Schema.Array(Schema.String),
  /** Rows that will change (UPDATE/DELETE), read when the fix was proposed. */
  preview: Schema.Array(DataRow),
  status: FixStatus,
  /** Rows just before the fix ran; the rollback source. */
  before: Schema.NullOr(Schema.Array(DataRow)),
  /** Rows as the fix left them. */
  after: Schema.NullOr(Schema.Array(DataRow)),
  error: Schema.NullOr(Schema.String),
  createdBy: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Fix = typeof Fix.Type;

export const FixEvent = Schema.Struct({
  id: Schema.Number,
  action: Schema.Literals([
    "proposed",
    "approved",
    "rejected",
    "applied",
    "apply_failed",
    "rollback_requested",
    "rolled_back",
    "rollback_failed",
  ]),
  actor: Schema.String,
  detail: Schema.NullOr(Schema.String),
  at: Schema.String,
});

/** GET /fixes/:id */
export const FixDetail = Schema.Struct({ fix: Fix, events: Schema.Array(FixEvent) });
export type FixDetail = typeof FixDetail.Type;

/** Body of approve / rollback. `actor` is the IT staff member (replaced by the login session in M5). */
export const FixActionRequest = Schema.Struct({ actor: NonEmpty.check(Schema.isMaxLength(100)) });
export type FixActionRequest = typeof FixActionRequest.Type;

export const RejectFixRequest = Schema.Struct({
  actor: NonEmpty.check(Schema.isMaxLength(100)),
  reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type RejectFixRequest = typeof RejectFixRequest.Type;

/** POST /fixes: an IT person proposes (or edits) a fix by hand. Same checks as the AI tool. */
export const CreateFixRequest = Schema.Struct({
  title: NonEmpty.check(Schema.isMaxLength(200)),
  reason: NonEmpty.check(Schema.isMaxLength(2_000)),
  sql: NonEmpty.check(Schema.isMaxLength(5_000)),
  params: Schema.optionalKey(Schema.Array(FixParam)),
  ticketId: Schema.optionalKey(Schema.String),
  createdBy: NonEmpty.check(Schema.isMaxLength(100)),
});
export type CreateFixRequest = typeof CreateFixRequest.Type;
