/**
 * Turns `SHOW CREATE TABLE` output into DDL for the synthetic test database.
 *
 * Foreign keys are removed because the test database only contains the tables
 * the harness uses, not the tables they point to (pegawai, kelurahan, ...).
 * Row counters (AUTO_INCREMENT=n) are removed so the file stays stable.
 */
export const toTestDdl = (createTable: string): string => {
  const lines = createTable.split("\n").filter((line) => !/^\s*CONSTRAINT\s.+FOREIGN KEY/i.test(line));
  // Removing the last definition can leave a trailing comma before ")".
  for (let i = 0; i < lines.length - 1; i++) {
    const next = lines[i + 1] ?? "";
    if (next.trimStart().startsWith(")")) {
      lines[i] = (lines[i] ?? "").replace(/,\s*$/, "");
    }
  }
  return lines.join("\n").replace(/\s+AUTO_INCREMENT=\d+/i, "") + ";";
};
