/**
 * docs/schema.md and docs/khanza_notes.md, parsed once at startup for
 * `lihatSkema`. Missing files give empty docs (the live schema still works).
 */
import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { KhanzaNotesPathConfig, SchemaDocPathConfig } from "../config.ts";

interface DocColumn {
  readonly name: string;
  readonly type: string;
  readonly key: string;
  readonly comment: string;
}

export interface DocTable {
  readonly table: string;
  readonly purpose: string;
  readonly columns: ReadonlyArray<DocColumn>;
  readonly foreignKeys: ReadonlyArray<string>;
}

export interface SchemaDocsService {
  readonly tables: ReadonlyArray<DocTable>;
  /** Non-empty lines of khanza_notes.md (bullets and headings). */
  readonly notes: ReadonlyArray<string>;
}

const cell = (text: string) => text.trim().replaceAll("`", "");

/** Parses the `## \`table\`` sections written by scripts/inspect-schema.ts. */
const parseSchemaDoc = (markdown: string): ReadonlyArray<DocTable> =>
  markdown
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const heading = /^`([^`]+)`/.exec(section);
      if (!heading?.[1]) return [];
      const lines = section.split("\n");
      const purpose = lines.find((l) => l.startsWith("Purpose:"))?.slice("Purpose:".length).trim() ?? "";
      const columns = lines
        .filter((l) => /^\| \d+ \|/.test(l))
        .map((l) => {
          const [, , name = "", type = "", , key = "", , , comment = ""] = l.split("|");
          return { name: cell(name), type: cell(type), key: cell(key), comment: cell(comment) };
        });
      const fkStart = lines.indexOf("Foreign keys:");
      const foreignKeys =
        fkStart === -1
          ? []
          : lines
              .slice(fkStart + 1)
              .filter((l) => l.startsWith("- "))
              .map((l) => cell(l.slice(2)));
      return [{ table: heading[1], purpose, columns, foreignKeys }];
    });

const parseNotes = (markdown: string): ReadonlyArray<string> =>
  markdown
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/\bTODO\b/.test(l));

export class SchemaDocs extends Context.Service<SchemaDocs, SchemaDocsService>()("simrs/SchemaDocs") {}

/** Docs from text (tests). */
export const schemaDocsLayer = (texts: { readonly schema: string; readonly notes: string }) =>
  Layer.succeed(SchemaDocs, { tables: parseSchemaDoc(texts.schema), notes: parseNotes(texts.notes) });

const readOrEmpty = (path: string) => Effect.promise(() => readFile(path, "utf8").catch(() => ""));

/** Docs from SCHEMA_DOC_PATH and KHANZA_NOTES_PATH (default: docs/ in the repository). */
export const SchemaDocsLive = Layer.effect(
  SchemaDocs,
  Effect.gen(function* () {
    const schema = yield* readOrEmpty(yield* SchemaDocPathConfig);
    const notes = yield* readOrEmpty(yield* KhanzaNotesPathConfig);
    return { tables: parseSchemaDoc(schema), notes: parseNotes(notes) };
  }),
);
