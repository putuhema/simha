/**
 * CSV for spreadsheet programs: comma-separated, quoted when needed, and a
 * BOM so Excel reads UTF-8. Shared by the UI (download a result or the usage
 * report) and the server (usage export).
 */

/** One CSV cell. */
export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A leading = + - @ would be run as a formula by spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const toCsv = (columns: ReadonlyArray<string>, rows: ReadonlyArray<Readonly<Record<string, unknown>>>): string => {
  const lines = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(","))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};
