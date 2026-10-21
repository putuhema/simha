import { Schema } from "effect";

/**
 * A Khanza query failed. `message` is short and safe to show to the AI model
 * so it can explain the problem or try something else.
 */
export class KhanzaQueryError extends Schema.TaggedError<KhanzaQueryError>()("KhanzaQueryError", {
  kind: Schema.Literals(["timeout", "syntax", "connection", "permission", "rejected", "other"]),
  message: Schema.String,
}) {}

/** The database connection is not safe to use (e.g. the read user can write). */
export class KhanzaSetupError extends Schema.TaggedError<KhanzaSetupError>()("KhanzaSetupError", {
  message: Schema.String,
}) {}

/** Tool parameters did not match the tool's Schema. The message is written for the AI model to retry. */
export class ToolInputError extends Schema.TaggedError<ToolInputError>()("ToolInputError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

/** A tool ran but could not produce a result. */
export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  tool: Schema.String,
  message: Schema.String,
}) {}
