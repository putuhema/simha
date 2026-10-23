/**
 * Builds a render block from a stored query result. Pure; used by the
 * `tampilkan` tool and by re-running a favorite.
 *
 * Checks what the UI needs: the named columns exist, chart values are
 * numbers, and charts and lists are small enough to read.
 */
import type { RenderBlock, RenderType } from "@simha/shared";
import type { QueryResult, Row } from "./ResultStore.ts";

export interface RenderSpec {
  readonly tipe: RenderType;
  readonly judul: string;
  readonly asumsi?: string | undefined;
  readonly opsi?:
    | {
        readonly x?: string | undefined;
        readonly y?: ReadonlyArray<string> | undefined;
        readonly kolom?: ReadonlyArray<string> | undefined;
        readonly satuan?: string | undefined;
      }
    | undefined;
}

/** Most categories a bar or pie chart, and most items a list, may have. */
const MAX_CATEGORIES = 50;
const MAX_SERIES = 5;

export class RenderRejected extends Error {
  override readonly name = "RenderRejected";
}

const reject = (message: string): never => {
  throw new RenderRejected(message);
};

const asNumber = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

const isNumericColumn = (rows: ReadonlyArray<Row>, column: string) =>
  rows.length > 0 && rows.every((row) => asNumber(row[column]) !== undefined);

export const buildBlock = (spec: RenderSpec, result: QueryResult, id: string = crypto.randomUUID()): RenderBlock => {
  const { columns, rows } = result;
  const opsi = spec.opsi ?? {};
  const known = new Set(columns);
  const need = (column: string) => {
    if (columns.length > 0 && !known.has(column)) {
      reject(`Kolom "${column}" tidak ada di hasil query. Kolom yang ada: ${columns.join(", ")}.`);
    }
    return column;
  };

  const numeric = columns.filter((c) => isNumericColumn(rows, c));
  const firstText = columns.find((c) => !numeric.includes(c));

  let kolom = columns;
  let x: string | null = null;
  let y: ReadonlyArray<string> = [];
  let baris = rows;

  switch (spec.tipe) {
    case "table":
      if (opsi.kolom) {
        const picked = opsi.kolom.map(need);
        kolom = picked;
        baris = rows.map((row) => Object.fromEntries(picked.map((c) => [c, row[c] ?? null])));
      }
      break;
    case "bar":
    case "line":
    case "pie": {
      if (rows.length === 0) {
        // Nothing to draw; the UI shows "tidak ada data" with the SQL.
        x = opsi.x ?? null;
        y = opsi.y ?? [];
        kolom = [...(x ? [x] : []), ...y];
        break;
      }
      x = need(opsi.x ?? firstText ?? columns[0] ?? "");
      y = (opsi.y ?? numeric.filter((c) => c !== x)).map(need);
      if (y.length === 0) reject(`Grafik ${spec.tipe} butuh minimal satu kolom angka (y). Kolom angka: ${numeric.join(", ") || "tidak ada"}.`);
      if (spec.tipe === "pie" && y.length !== 1) reject("Grafik pie butuh tepat satu kolom angka (y).");
      if (y.length > MAX_SERIES) reject(`Grafik paling banyak ${MAX_SERIES} seri (kolom y).`);
      for (const column of y) {
        if (rows.length > 0 && !isNumericColumn(rows, column)) reject(`Kolom "${column}" bukan angka, tidak bisa dipakai sebagai y.`);
      }
      if (spec.tipe !== "line" && rows.length > MAX_CATEGORIES) {
        reject(`Terlalu banyak kategori untuk grafik ${spec.tipe} (${rows.length}). Batasi dengan LIMIT ${MAX_CATEGORIES} atau pakai tipe table.`);
      }
      const xColumn = x;
      kolom = [xColumn, ...y];
      baris = rows.map((row) => ({
        [xColumn]: row[xColumn] ?? null,
        ...Object.fromEntries(y.map((c) => [c, asNumber(row[c]) ?? null])),
      }));
      break;
    }
    case "stat": {
      if (rows.length !== 1) reject(`Tipe stat butuh tepat 1 baris hasil, query mengembalikan ${rows.length}. Pakai table atau bar.`);
      const value = need(opsi.y?.[0] ?? numeric[0] ?? columns[0] ?? "");
      y = [value];
      x = opsi.x ? need(opsi.x) : null;
      kolom = x ? [x, value] : [value];
      break;
    }
    case "list":
      x = need(opsi.x ?? columns[0] ?? "");
      if (rows.length > MAX_CATEGORIES * 2) reject(`Terlalu banyak item untuk list (${rows.length}). Pakai tipe table.`);
      kolom = [x];
      break;
  }

  return {
    id,
    tipe: spec.tipe,
    judul: spec.judul,
    asumsi: spec.asumsi ?? null,
    queryId: result.id,
    sql: result.sqlFinal,
    kolom: [...kolom],
    baris: [...baris],
    x,
    y: [...y],
    satuan: opsi.satuan ?? null,
    terpotong: result.truncated,
  };
};
