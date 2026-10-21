import { describe, expect, it } from "vitest";
import type { ExpectedTable } from "./khanza-tables.ts";
import { cell, findMissing, renderSchemaMarkdown, type ColumnInfo, type TableInfo } from "./schema-markdown.ts";

const expected: ReadonlyArray<ExpectedTable> = [
  { name: "pasien", purpose: "Patients", columns: ["no_rkm_medis", "nm_pasien", "no_ktp"] },
  { name: "kamar", purpose: "Rooms", columns: ["kd_kamar", "status"] },
];

const tables: ReadonlyArray<TableInfo> = [
  { tableName: "pasien", engine: "InnoDB", tableRows: 1200, tableComment: null },
];

const col = (tableName: string, columnName: string, ordinalPosition: number, columnType = "varchar(15)"): ColumnInfo => ({
  tableName,
  columnName,
  ordinalPosition,
  columnType,
  isNullable: "NO",
  columnKey: ordinalPosition === 1 ? "PRI" : "",
  columnDefault: null,
  extra: "",
  columnComment: "",
});

const columns: ReadonlyArray<ColumnInfo> = [
  col("pasien", "no_rkm_medis", 1),
  col("pasien", "nm_pasien", 2, "varchar(40)"),
  // no_ktp intentionally absent: simulates a modified schema
  col("pasien", "jenis_kelamin_custom", 3, "enum('L','P')"),
];

describe("findMissing", () => {
  it("reports missing tables and columns", () => {
    expect(findMissing(expected, tables, columns)).toEqual({
      missingTables: ["kamar"],
      missingColumns: [{ table: "pasien", column: "no_ktp" }],
    });
  });

  it("is case-insensitive", () => {
    const upper = columns.map((c) => ({ ...c, tableName: "PASIEN", columnName: c.columnName.toUpperCase() }));
    const result = findMissing(expected.slice(0, 1), [{ ...tables[0]!, tableName: "Pasien" }], upper);
    expect(result.missingColumns).toEqual([{ table: "pasien", column: "no_ktp" }]);
  });
});

describe("renderSchemaMarkdown", () => {
  const md = renderSchemaMarkdown({
    database: "sik",
    serverVersion: "10.11.6-MariaDB",
    generatedAt: new Date("2026-10-22T00:00:00Z"),
    expected,
    requested: [],
    tables,
    columns,
    indexes: [{ tableName: "pasien", indexName: "PRIMARY", nonUnique: 0, seqInIndex: 1, columnName: "no_rkm_medis" }],
    foreignKeys: [],
  });

  it("lists differences first", () => {
    expect(md).toContain("- `kamar`");
    expect(md).toContain("- `pasien.no_ktp`");
  });

  it("documents columns in order with escaped types", () => {
    expect(md).toContain("| 3 | `jenis_kelamin_custom` | enum('L','P') |");
    expect(md.indexOf("`no_rkm_medis` |")).toBeLessThan(md.indexOf("`nm_pasien` |"));
    expect(md).toContain("- unique `PRIMARY` (no_rkm_medis)");
  });
});

describe("cell", () => {
  it("escapes pipes and newlines", () => {
    expect(cell("a|b\nc")).toBe("a\\|b c");
    expect(cell(null)).toBe("");
  });
});
