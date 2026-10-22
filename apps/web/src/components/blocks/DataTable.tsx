/**
 * Result table: click a header to sort, numbers right-aligned. TanStack Table
 * v9 with only the sorting feature.
 */
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo } from "react";
import { formatNumber } from "../../lib/format.ts";

type Row = Readonly<Record<string, unknown>>;

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});
const helper = createColumnHelper<typeof features, Row>();

const cellText = (value: unknown) =>
  value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

export const DataTable = ({
  columns,
  rows,
  maxHeight = 420,
}: {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<Row>;
  readonly maxHeight?: number;
}) => {
  const numeric = useMemo(
    () => new Set(columns.filter((c) => rows.length > 0 && rows.every((r) => r[c] === null || typeof r[c] === "number"))),
    [columns, rows],
  );
  const columnDefs = useMemo(
    () =>
      helper.columns(
        columns.map((column) =>
          helper.accessor((row) => row[column], {
            id: column,
            header: column,
            sortUndefined: "last",
            cell: (info) => {
              const value = info.getValue();
              return numeric.has(column) ? formatNumber(value) : cellText(value);
            },
          }),
        ),
      ),
    [columns, numeric],
  );
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({ features, columns: columnDefs, data });

  return (
    <div className="overflow-auto rounded-md border border-line-2" style={{ maxHeight }}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-paper-2">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    className={`border-b border-line px-3 py-1.5 text-left font-mono text-[11.5px] font-medium whitespace-nowrap text-ink-2 ${numeric.has(header.column.id) ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      <table.FlexRender header={header} />
                      {sorted === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 opacity-30" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="odd:bg-card even:bg-paper/50 hover:bg-teal-soft/40">
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`border-b border-line-2 px-3 py-1.5 align-top ${numeric.has(cell.column.id) ? "text-right font-mono tabular-nums" : ""}`}
                >
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-ink-3">Tidak ada data.</p> : null}
    </div>
  );
};
