/**
 * The system prompt: agent/system-prompt.md followed by docs/khanza_notes.md,
 * read once at startup. It does not change between requests, so providers
 * with prompt caching can reuse it.
 */
import { Config, Context, Effect, FileSystem, Layer } from "effect";
import * as NodePath from "node:path";

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..", "..", "..");

const KhanzaNotesPathConfig = Config.String("KHANZA_NOTES_PATH").pipe(
  Config.withDefault(NodePath.join(repoRoot, "docs", "khanza_notes.md")),
);

export class SystemPrompt extends Context.Service<SystemPrompt, string>()("simrs/SystemPrompt") {}

export const SystemPromptLive = Layer.effect(
  SystemPrompt,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const base = yield* fs.readFileString(NodePath.join(import.meta.dirname, "system-prompt.md"));
    const notesPath = yield* KhanzaNotesPathConfig;
    const notes = yield* fs.readFileString(notesPath).pipe(
      Effect.catch(() => Effect.succeed("(docs/khanza_notes.md belum ada.)")),
    );
    return `${base.trim()}\n\n${notes.trim()}\n`;
  }),
);

/** Fixed prompt for tests. */
export const systemPromptLayer = (text: string) => Layer.succeed(SystemPrompt, text);
