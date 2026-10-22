/**
 * The set of tools offered to the AI model, with their JSON Schemas.
 */
import { Schema } from "effect";
import { diagnosaPindahKamar } from "./diagnose/diagnosaPindahKamar.ts";
import { diagnosaTindakan } from "./diagnose/diagnosaTindakan.ts";
import type { FixStore } from "./fixes/FixStore.ts";
import type { KhanzaRead } from "./khanza/KhanzaRead.ts";
import { usulkanPerbaikan } from "./propose/usulkanPerbaikan.ts";
import { readTools } from "./read/index.ts";
import type { Tool } from "./tool.ts";

/** Services tool handlers may use. Never the Khanza write pool. */
export type ToolServices = KhanzaRead | FixStore;

/** A tool with its parameter and output types erased, for lists of mixed tools. */
export type AnyTool<R = ToolServices> = Tool<unknown, unknown, R>;

/** Provider-neutral description of a tool: what packages/llm adapters send to the model. */
export interface ToolDescription {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** JSON Schema (draft 2020-12) of a tool's parameters, as providers expect it. */
export const parametersJsonSchema = (tool: AnyTool<unknown>): Record<string, unknown> => {
  const document = Schema.toJsonSchemaDocument(tool.parameters);
  const definitions = document.definitions ?? {};
  return {
    ...document.schema,
    additionalProperties: false,
    ...(Object.keys(definitions).length > 0 ? { $defs: definitions } : {}),
  };
};

export interface ToolRegistry<R = ToolServices> {
  readonly tools: ReadonlyArray<AnyTool<R>>;
  readonly descriptions: ReadonlyArray<ToolDescription>;
  readonly get: (name: string) => AnyTool<R> | undefined;
}

export const makeRegistry = <R>(tools: ReadonlyArray<AnyTool<R>>): ToolRegistry<R> => {
  const byName = new Map(tools.map((t) => [t.name, t]));
  if (byName.size !== tools.length) throw new Error("Duplicate tool names in registry");
  return {
    tools,
    descriptions: tools.map((t) => ({ name: t.name, description: t.description, parameters: parametersJsonSchema(t) })),
    get: (name) => byName.get(name),
  };
};

/** Tools offered to the agent: read, diagnose and propose. Information tools join in M4. */
export const defaultRegistry: ToolRegistry = makeRegistry([
  ...readTools,
  diagnosaPindahKamar,
  diagnosaTindakan,
  usulkanPerbaikan,
] as unknown as ReadonlyArray<AnyTool>);
