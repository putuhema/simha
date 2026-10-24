/** CSV helpers, including download. The escaping itself is shared with the server. */
export { toCsv } from "@simha/shared/csv";

export const downloadCsv = (fileName: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

/** Downloads an already-encoded CSV response (the server's usage export). */
export const downloadCsvResponse = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
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
