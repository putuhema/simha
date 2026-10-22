/** One CSV cell. */
const cell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A leading = + - @ would be run as a formula by spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** CSV for spreadsheet programs: comma-separated, quoted when needed, with a BOM so Excel reads UTF-8. */
export const toCsv = (columns: ReadonlyArray<string>, rows: ReadonlyArray<Readonly<Record<string, unknown>>>): string => {
  const lines = [columns.map(cell).join(","), ...rows.map((row) => columns.map((c) => cell(row[c])).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

export const downloadCsv = (fileName: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

/** File name from a block title: "10 tindakan terbanyak" -> "10-tindakan-terbanyak". */
export const fileNameFor = (title: string) =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 60) || "hasil";
